import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdapter } from '@/lib/storage';
import { sampleDatabase } from '@/lib/storage/sample';
import { DatabaseSchema } from '@/lib/schemas';
import { contentHash } from '@/lib/sharing/hash';
import {
  setStorageAdapter, getClients, createClient, createProject, getPhases, logDiscussion, getProject,
  createAgreement, current, recordAcceptance, getAgreement, markSent, addReceipt, getPayments, exportAll, importAll, getDb
} from './test-exports';
import { totals } from '@/lib/logic/payments';

beforeEach(async () => { setStorageAdapter(new MemoryAdapter(await sampleDatabase('2026-11-18'))); });

describe('sample data', () => {
  it('validates against the schemas and has the promised spread', async () => {
    const db = DatabaseSchema.parse(await sampleDatabase());
    expect(db.clients).toHaveLength(4);
    expect(db.projects).toHaveLength(5);
    expect(db.agreements.flatMap((a) => a.versions).some((v) => v.status === 'accepted')).toBe(true);
    expect(db.agreements.flatMap((a) => a.versions).some((v) => v.status === 'draft')).toBe(true);
    expect(db.discussions.some((d) => d.scopeChange)).toBe(true);
    expect(db.discussions.some((d) => d.tags.includes('disputed'))).toBe(true);
  });
});

describe('repositories', () => {
  it('creates a client and a project with phases, then shifts a deadline from a scope change', async () => {
    const before = (await getClients()).length;
    const c = await createClient({ name: 'Test Client', phone: '', email: '', address: '', city: 'Surat', source: 'referral', notes: '', tags: [], status: 'lead' });
    expect((await getClients()).length).toBe(before + 1);
    const p = await createProject({
      clientId: c.id, title: 'Test House', type: 'residential', siteLocation: 'Surat', plotAreaSqft: null, builtUpAreaSqft: null, budgetMin: null, budgetMax: null,
      status: 'in-progress', startDate: '2026-11-01', currentDeadline: '2027-01-31', teamMembers: [], tags: []
    }, [
      { name: 'Concept', description: '', deliverables: [], startDate: '2026-11-01', dueDate: '2026-11-30', status: 'in-progress', revisionsAllowed: 2, revisionsUsed: 0, paymentMilestoneId: null },
      { name: '2D plans', description: '', deliverables: [], startDate: '2026-12-01', dueDate: '2026-12-31', status: 'not-started', revisionsAllowed: 2, revisionsUsed: 0, paymentMilestoneId: null }
    ]);
    const [concept] = await getPhases(p.id);
    const d = await logDiscussion({
      projectId: p.id, at: '2026-11-18T10:00:00+05:30', channel: 'whatsapp', summary: 'Client added a terrace', decisions: [], actionItems: [], attachments: [],
      scopeChange: true, impact: { days: 10, costInr: 20000, notes: '' }, tags: []
    }, { phaseId: concept!.id, to: '2026-12-10', reason: 'Terrace added', cascade: true, moveProject: true });
    const phases = await getPhases(p.id);
    expect(phases[0]).toMatchObject({ dueDate: '2026-12-10', originalDueDate: '2026-11-30' });
    expect(phases[0]!.dueDateHistory[0]!.discussionId).toBe(d.id);
    expect(phases[1]!.dueDate).toBe('2027-01-10');
    expect((await getProject(p.id))!.currentDeadline).toBe('2027-02-10');
  });

  it('records an acceptance only when the receipt matches the content', async () => {
    const a = await createAgreement({ projectId: 'p-patel', title: 'Test agreement', templateId: 'tpl-residential' });
    const v = current(a);
    await markSent(a.id, v.id);
    const base = { kind: 'pln-acceptance' as const, format: 1 as const, token: v.token, agreementId: a.id, versionId: v.id, version: 1, title: a.title, acceptedByName: 'Harsh Patel', acceptedAt: '2026-11-18T12:00:00.000Z' };
    expect((await recordAcceptance({ ...base, contentHash: 'f'.repeat(64) })).ok).toBe(false);
    expect((await recordAcceptance({ ...base, contentHash: await contentHash(v.content) })).ok).toBe(true);
    expect(current((await getAgreement(a.id))!)).toMatchObject({ status: 'accepted', acceptedByName: 'Harsh Patel' });
  });

  it('updates outstanding totals when a receipt is recorded', async () => {
    const before = totals(await getPayments('p-desai'), '2026-11-18');
    await addReceipt('pay-d2', { date: '2026-11-18', amount: 75000, mode: 'upi', reference: 'UPI 1', notes: '' });
    const after = totals(await getPayments('p-desai'), '2026-11-18');
    expect(after.outstanding).toBe(before.outstanding - 75000);
    expect(after.received).toBe(before.received + 75000);
  });

  it('round-trips export → import without loss', async () => {
    const json = await exportAll();
    const original = structuredClone(await getDb());
    setStorageAdapter(new MemoryAdapter(await sampleDatabase('2025-01-01')));
    const res = await importAll(json);
    expect(res.ok).toBe(true);
    const restored = await getDb();
    expect({ ...restored, activity: restored.activity.slice(1) }).toEqual(original);
    expect((await importAll('{"app":"other"}')).ok).toBe(false);
    expect((await importAll('not json')).ok).toBe(false);
  });
});
