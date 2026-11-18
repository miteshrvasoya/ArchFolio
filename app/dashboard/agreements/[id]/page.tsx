'use client';
import '@/components/agreement/agreement.css';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import {
  createNewVersion, deleteDraftVersion, getAgreement, getPayments, getProject, getSettings, latest, revokeVersion, schedulePaymentsFromAgreement
} from '@/lib/repositories';
import { checkMilestones } from '@/lib/logic/milestones';
import { formatDate, formatDateTime } from '@/lib/format';
import { useData } from '@/lib/hooks/useData';
import { Async, Card, Empty, Field, Loading, Modal, PageHead, StatusChip, useAction, useUi } from '@/components/dashboard/ui';
import { AGREEMENT_TONES } from '@/components/dashboard/status';
import { AgreementEditor } from '@/components/dashboard/agreement/AgreementEditor';
import { AgreementDocument, DISCLAIMER } from '@/components/agreement/AgreementDocument';
import { SharePanel } from '@/components/dashboard/agreement/SharePanel';

export default function AgreementPage() {
  return <Suspense fallback={<Loading />}><AgreementDetail /></Suspense>;
}

function AgreementDetail() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { run, busy } = useAction();
  const { confirm } = useUi();
  const [newVersionOpen, setNewVersionOpen] = useState(false);
  const [note, setNote] = useState('');
  const state = useData(async () => {
    const agreement = await getAgreement(id);
    if (!agreement) return null;
    const [project, settings, payments] = await Promise.all([getProject(agreement.projectId), getSettings(), getPayments(agreement.projectId)]);
    return { agreement, project, settings, scheduled: payments.filter((p) => p.agreementId === agreement.id).length };
  }, [id]);

  return (
    <Async state={state}>
      {(d) => {
        if (!d) return <Empty title="Agreement not found" action={<Link className="btn" href="/dashboard/agreements">All agreements</Link>} />;
        const { agreement: a, project, settings } = d;
        const versions = [...a.versions].sort((x, y) => y.version - x.version);
        const v = versions.find((x) => x.id === params.get('v')) ?? latest(a);
        const fees = checkMilestones(v.content.fees.milestones);
        const branding = { name: settings.firm.name, architectName: settings.firm.architectName, coaNumber: settings.firm.coaNumber, phone: settings.firm.phone, email: settings.firm.email, logoUrl: settings.firm.logoUrl };
        const select = (vid: string) => router.replace(`/dashboard/agreements/${a.id}?v=${vid}`, { scroll: false });
        return (
          <>
            <PageHead
              crumbs={[{ href: '/dashboard/agreements', label: 'Agreements' }, ...(project ? [{ href: `/dashboard/projects/${project.id}?tab=agreement`, label: project.title }] : [])]}
              title={a.title}
              actions={<>
                <button type="button" className="btn" onClick={() => window.print()}>Print / PDF</button>
                {!a.versions.some((x) => x.status === 'draft') && <button type="button" className="btn" onClick={() => setNewVersionOpen(true)}>New version</button>}
              </>}
            />
            <div className={v.status === 'draft' ? 'stack' : 'grid side-main'} style={v.status === 'draft' ? undefined : { gridTemplateColumns: 'minmax(0, 1fr) 300px' }}>
              <div className="stack" style={{ order: 0 }}>
                <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <StatusChip value={v.status} tones={AGREEMENT_TONES} />
                  <span className="mono">Version {v.version}</span>
                  {v.changeNote && <span className="muted">— {v.changeNote}</span>}
                  {v.status !== 'draft' && <span className="faint">(read-only)</span>}
                </div>
                {v.status === 'superseded' && <div className="notice no-print">This version was replaced by a newer one. It stays here as a record.</div>}
                {v.status === 'cancelled' && <div className="notice no-print">This version was revoked. A link already sent keeps working until a backend can refuse it.</div>}
                {v.status === 'draft' ? (
                  <AgreementEditor key={v.id} agreementId={a.id} versionId={v.id} title={a.title} version={v.version} initial={v.content} initialNote={v.changeNote} settings={settings} />
                ) : (
                  <div className="card ink print-area" style={{ padding: 0 }}>
                    <AgreementDocument content={v.content} title={a.title} version={v.version} branding={branding} issuedOn={v.sentAt ?? v.createdAt}
                      acceptance={v.status === 'accepted' && v.acceptedByName && v.acceptedAt ? { name: v.acceptedByName, at: v.acceptedAt, hash: v.acceptanceHash } : null} />
                  </div>
                )}
              </div>
              <aside className={`no-print ${v.status === 'draft' ? 'grid three' : 'stack'}`} aria-label="Agreement actions" style={{ alignItems: 'start' }}>
                <SharePanel agreement={a} version={v} settings={settings} clientPhone={v.content.parties.client.phone} clientEmail={v.content.parties.client.email} feesValid={fees.valid} />
                <Card title="Versions">
                  <ul className="version-list">
                    {versions.map((x) => (
                      <li key={x.id}>
                        <a href={`?v=${x.id}`} aria-current={x.id === v.id} onClick={(e) => { e.preventDefault(); select(x.id); }}>
                          <span><span className="mono">v{x.version}</span> <small className="faint">{formatDate(x.updatedAt)}</small></span>
                          <StatusChip value={x.status} tones={AGREEMENT_TONES} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card title="Record">
                  <dl className="kv">
                    <dt>Created</dt><dd>{formatDateTime(v.createdAt)}</dd>
                    <dt>Sent</dt><dd>{formatDateTime(v.sentAt)}</dd>
                    <dt>Viewed</dt><dd>{formatDateTime(v.viewedAt)}</dd>
                    <dt>Accepted</dt><dd>{v.acceptedAt ? `${formatDateTime(v.acceptedAt)} by ${v.acceptedByName}` : '—'}</dd>
                  </dl>
                  {v.acceptanceHash && <p className="mono faint" style={{ fontSize: '0.66rem', overflowWrap: 'anywhere' }}>SHA-256 {v.acceptanceHash}</p>}
                </Card>
                <Card title="Payments">
                  <p className="muted" style={{ marginTop: 0 }}>{d.scheduled ? `${d.scheduled} payment${d.scheduled > 1 ? 's' : ''} scheduled from this agreement.` : 'Create one payment per milestone of the governing version.'}</p>
                  <div className="actions">
                    <button type="button" className="btn small" disabled={busy || !fees.valid} onClick={async () => {
                      const n = await run(() => schedulePaymentsFromAgreement(a.id));
                      if (n !== undefined) router.push(`/dashboard/payments?project=${a.projectId}`);
                    }}>Schedule milestone payments</button>
                  </div>
                </Card>
                <Card title="Danger zone">
                  <div className="actions">
                    {v.status === 'draft' && <button type="button" className="btn danger small" onClick={async () => {
                      if (await confirm({ title: `Delete draft v${v.version}?`, message: a.versions.length === 1 ? 'This is the only version — the whole agreement is deleted.' : 'The draft is deleted; earlier versions remain.', confirmLabel: 'Delete', danger: true })) {
                        const ok = await run(() => deleteDraftVersion(a.id, v.id).then(() => true), 'Draft deleted');
                        if (ok) router.replace(a.versions.length === 1 ? '/dashboard/agreements' : `/dashboard/agreements/${a.id}`);
                      }
                    }}>Delete draft</button>}
                    {['sent', 'viewed', 'accepted'].includes(v.status) && <button type="button" className="btn danger small" onClick={async () => {
                      if (await confirm({ title: `Revoke v${v.version}?`, message: 'The version is marked cancelled here. Without a backend, a link the client already has will keep opening — tell the client in writing that this version is withdrawn.', confirmLabel: 'Revoke', danger: true })) run(() => revokeVersion(a.id, v.id), 'Version revoked');
                    }}>Revoke this version</button>}
                  </div>
                </Card>
                <p className="disclaimer">{DISCLAIMER}</p>
              </aside>
            </div>
            <Modal open={newVersionOpen} onClose={() => setNewVersionOpen(false)} title="Start a new version">
              <p style={{ fontFamily: 'var(--f-text)' }}>The new version starts as a draft copy of the governing version. Earlier versions stay viewable and read-only; they become superseded when the new one is sent.</p>
              <Field label="What changed?" hint="e.g. Scope change: terrace garden added (+₹50,000, +14 days)">{(fid, dsc) => <input id={fid} aria-describedby={dsc} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
              <div className="form-actions"><button type="button" className="btn primary" disabled={!note.trim() || busy} onClick={async () => {
                const nv = await run(() => createNewVersion(a.id, note.trim()), 'New draft version created');
                if (nv) { setNewVersionOpen(false); setNote(''); select(nv.id); }
              }}>Create draft</button></div>
            </Modal>
          </>
        );
      }}
    </Async>
  );
}
