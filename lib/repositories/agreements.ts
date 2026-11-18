import {
  AgreementContentSchema, type Agreement, type AgreementContent, type AgreementTemplate, type AgreementVersion, type Database
} from '@/lib/schemas';
import { contentHash } from '@/lib/sharing/hash';
import type { AcceptanceReceipt } from '@/lib/sharing/receipt';
import { formatDate } from '@/lib/format';
import { clientIdOfProject, DataError, getDb, logActivity, mustFind, mutate, newId, newToken, nowIso } from './db';

export async function getAgreements(): Promise<Agreement[]> {
  return [...(await getDb()).agreements].sort((a, b) => latest(b).updatedAt.localeCompare(latest(a).updatedAt));
}
export async function getAgreement(id: string): Promise<Agreement | null> {
  return (await getDb()).agreements.find((a) => a.id === id) ?? null;
}
export async function getAgreementsForProject(projectId: string): Promise<Agreement[]> {
  return (await getAgreements()).filter((a) => a.projectId === projectId);
}
export async function getTemplates(): Promise<AgreementTemplate[]> {
  return (await getDb()).templates;
}

/** Newest version (highest number). */
export function latest(a: Agreement): AgreementVersion {
  return a.versions.reduce((m, v) => (v.version > m.version ? v : m), a.versions[0] as AgreementVersion);
}
/** The version that currently governs the project: newest accepted, else newest. */
export function current(a: Agreement): AgreementVersion {
  const accepted = a.versions.filter((v) => v.status === 'accepted');
  return accepted.length ? accepted.reduce((m, v) => (v.version > m.version ? v : m)) : latest(a);
}

/** Build starting content: template clauses + firm/client/project details + the project's phases. */
function buildContent(db: Database, projectId: string, base: AgreementContent): AgreementContent {
  const project = mustFind(db.projects, projectId, 'Project');
  const client = db.clients.find((c) => c.id === project.clientId);
  const f = db.settings.firm;
  const phases = db.phases.filter((p) => p.projectId === projectId).sort((a, b) => a.order - b.order);
  const area = [project.plotAreaSqft ? `Plot ${project.plotAreaSqft.toLocaleString('en-IN')} sq ft` : '', project.builtUpAreaSqft ? `built-up ${project.builtUpAreaSqft.toLocaleString('en-IN')} sq ft` : ''].filter(Boolean).join(' · ');
  const content: AgreementContent = structuredClone(base);
  content.parties = {
    architect: { firmName: f.name, architectName: f.architectName, coaNumber: f.coaNumber, address: [f.address, f.city].filter(Boolean).join(', '), phone: f.phone, email: f.email, gstin: f.gstin },
    client: { name: client?.name ?? '', address: [client?.address, client?.city].filter(Boolean).join(', '), phone: client?.phone ?? '', email: client?.email ?? '' }
  };
  content.project = { ...content.project, title: project.title, site: project.siteLocation, area: area || content.project.area };
  if (phases.length) {
    content.phases = phases.map((p) => ({ name: p.name, deliverables: p.deliverables, start: p.startDate, end: p.dueDate, revisions: p.revisionsAllowed }));
  }
  content.timeline.overallDeadline = project.currentDeadline ?? content.timeline.overallDeadline;
  return AgreementContentSchema.parse(content);
}

function newVersion(n: number, content: AgreementContent, changeNote: string): AgreementVersion {
  const now = nowIso();
  return { id: newId(), version: n, token: newToken(), status: 'draft', createdAt: now, updatedAt: now, sentAt: null, viewedAt: null, acceptedAt: null, acceptedByName: null, acceptanceHash: null, changeNote, content };
}

export interface CreateAgreementInput {
  projectId: string;
  title: string;
  templateId?: string | null;
  /** duplicate clauses and fees from an earlier agreement */
  fromAgreementId?: string | null;
}

export async function createAgreement(input: CreateAgreementInput): Promise<Agreement> {
  return mutate((db) => {
    let base: AgreementContent;
    if (input.fromAgreementId) base = current(mustFind(db.agreements, input.fromAgreementId, 'Agreement')).content;
    else if (input.templateId) base = mustFind(db.templates, input.templateId, 'Template').content;
    else base = (db.templates[0] ?? (() => { throw new DataError('No agreement templates available'); })()).content;
    const content = buildContent(db, input.projectId, base);
    const agreement: Agreement = {
      id: newId(), projectId: input.projectId, title: input.title, templateId: input.templateId ?? null, createdAt: nowIso(),
      versions: [newVersion(1, content, input.fromAgreementId ? 'Duplicated from a previous agreement' : 'First draft')]
    };
    db.agreements.push(agreement);
    const p = db.projects.find((x) => x.id === input.projectId);
    if (p && p.status === 'inquiry') p.status = 'agreement-pending';
    logActivity(db, 'agreement-created', `Agreement draft created: ${agreement.title}`, input.projectId, clientIdOfProject(db, input.projectId));
    return agreement;
  });
}

/** Save a draft. Sent, accepted and older versions are read-only. */
export async function saveDraft(agreementId: string, versionId: string, content: AgreementContent, changeNote?: string): Promise<AgreementVersion> {
  const clean = AgreementContentSchema.parse(content);
  return mutate((db) => {
    const a = mustFind(db.agreements, agreementId, 'Agreement');
    const v = mustFind(a.versions, versionId, 'Version');
    if (v.status !== 'draft') throw new DataError(`Version ${v.version} is ${v.status} and can no longer be edited. Create a new version instead.`);
    v.content = clean;
    if (changeNote !== undefined) v.changeNote = changeNote;
    v.updatedAt = nowIso();
    return v;
  });
}

export async function renameAgreement(agreementId: string, title: string): Promise<void> {
  await mutate((db) => { mustFind(db.agreements, agreementId, 'Agreement').title = title; });
}

/** New draft version (scope changed). Earlier versions stay viewable and become superseded once it is sent. */
export async function createNewVersion(agreementId: string, changeNote: string): Promise<AgreementVersion> {
  return mutate((db) => {
    const a = mustFind(db.agreements, agreementId, 'Agreement');
    if (a.versions.some((v) => v.status === 'draft')) throw new DataError('There is already a draft version — edit that one.');
    const v = newVersion(latest(a).version + 1, structuredClone(current(a).content), changeNote);
    a.versions.push(v);
    logActivity(db, 'agreement-version', `${a.title}: version ${v.version} started — ${changeNote}`, a.projectId, clientIdOfProject(db, a.projectId));
    return v;
  });
}

/** Mark a version as sent (done automatically when a link is copied or shared). */
export async function markSent(agreementId: string, versionId: string): Promise<AgreementVersion> {
  return mutate((db) => {
    const a = mustFind(db.agreements, agreementId, 'Agreement');
    const v = mustFind(a.versions, versionId, 'Version');
    if (v.status === 'cancelled') throw new DataError('This version was revoked.');
    if (v.status === 'draft') {
      v.status = 'sent';
      v.sentAt = nowIso();
      v.updatedAt = v.sentAt;
      for (const o of a.versions) if (o.id !== v.id && o.version < v.version && ['sent', 'viewed', 'accepted', 'draft'].includes(o.status)) o.status = 'superseded';
      logActivity(db, 'agreement-sent', `${a.title}: version ${v.version} sent`, a.projectId, clientIdOfProject(db, a.projectId));
    }
    return v;
  });
}

export async function markViewed(agreementId: string, versionId: string): Promise<void> {
  await mutate((db) => {
    const v = mustFind(mustFind(db.agreements, agreementId, 'Agreement').versions, versionId, 'Version');
    if (v.status === 'sent') { v.status = 'viewed'; v.viewedAt = nowIso(); }
  });
}

/** Revoke: marks the version cancelled here. A link already sent keeps working until a backend can refuse it. */
export async function revokeVersion(agreementId: string, versionId: string): Promise<void> {
  await mutate((db) => {
    const a = mustFind(db.agreements, agreementId, 'Agreement');
    const v = mustFind(a.versions, versionId, 'Version');
    v.status = 'cancelled';
    v.updatedAt = nowIso();
    logActivity(db, 'agreement-revoked', `${a.title}: version ${v.version} revoked`, a.projectId, clientIdOfProject(db, a.projectId));
  });
}

export async function deleteDraftVersion(agreementId: string, versionId: string): Promise<void> {
  await mutate((db) => {
    const a = mustFind(db.agreements, agreementId, 'Agreement');
    const v = mustFind(a.versions, versionId, 'Version');
    if (v.status !== 'draft') throw new DataError('Only drafts can be deleted.');
    if (a.versions.length === 1) db.agreements = db.agreements.filter((x) => x.id !== agreementId);
    else a.versions = a.versions.filter((x) => x.id !== versionId);
  });
}

export type RecordAcceptanceResult = { ok: true; title: string; version: number } | { ok: false; message: string };

/**
 * Record an acceptance from a client's receipt (PLACEHOLDER until a backend
 * stores acceptances). The receipt must match a known version, and its content
 * hash must match that version's content exactly.
 */
export async function recordAcceptance(receipt: AcceptanceReceipt): Promise<RecordAcceptanceResult> {
  const db = await getDb();
  const a = db.agreements.find((x) => x.id === receipt.agreementId);
  const v = a?.versions.find((x) => x.id === receipt.versionId && x.token === receipt.token);
  if (!a || !v) return { ok: false, message: 'This receipt is for an agreement that is not in this dashboard.' };
  if (v.status === 'cancelled') return { ok: false, message: `Version ${v.version} was revoked; the acceptance was not recorded.` };
  const hash = await contentHash(v.content);
  if (hash !== receipt.contentHash) return { ok: false, message: `The receipt does not match version ${v.version} as stored here (the content differs). Check you are importing the right receipt.` };
  if (v.status === 'accepted') return { ok: true, title: a.title, version: v.version };
  await mutate((d) => {
    const ag = mustFind(d.agreements, a.id, 'Agreement');
    const ver = mustFind(ag.versions, v.id, 'Version');
    ver.status = 'accepted';
    ver.acceptedAt = receipt.acceptedAt;
    ver.acceptedByName = receipt.acceptedByName;
    ver.acceptanceHash = receipt.contentHash;
    ver.viewedAt = ver.viewedAt ?? receipt.acceptedAt;
    ver.sentAt = ver.sentAt ?? receipt.acceptedAt;
    ver.updatedAt = nowIso();
    for (const o of ag.versions) if (o.version < ver.version && o.status !== 'cancelled') o.status = 'superseded';
    const p = d.projects.find((x) => x.id === ag.projectId);
    if (p && p.status === 'agreement-pending') p.status = 'in-progress';
    logActivity(d, 'agreement-accepted', `${ag.title}: version ${ver.version} accepted by ${receipt.acceptedByName} on ${formatDate(receipt.acceptedAt)}`, ag.projectId, clientIdOfProject(d, ag.projectId));
  });
  return { ok: true, title: a.title, version: v.version };
}
