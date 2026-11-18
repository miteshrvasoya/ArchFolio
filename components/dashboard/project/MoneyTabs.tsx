'use client';
/** Project tabs for agreements, payments and documents (with release-after-payment tracking). */
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { DocumentType, type Agreement, type Doc, type Payment, type Project } from '@/lib/schemas';
import { createDocument, deleteDocument, latest, releaseDocument, updateDocument } from '@/lib/repositories';
import { summarisePayment } from '@/lib/logic/payments';
import { formatDate, formatINR, label, todayIST } from '@/lib/format';
import { Chip, Empty, Field, Modal, StatusChip, useAction, useUi } from '../ui';
import { AGREEMENT_TONES } from '../status';
import { PaymentForm, PaymentsTable } from '../payments/PaymentsTable';

export function AgreementTab({ project, agreements }: { project: Project; agreements: Agreement[] }) {
  return (
    <div className="stack">
      <div className="actions"><Link className="btn primary" href={`/dashboard/agreements/new?project=${project.id}`}>+ New agreement</Link></div>
      {agreements.length === 0 ? <Empty title="No agreement yet">Send a written agreement before (or as early as possible into) the work.</Empty> : (
        <ul className="list card">
          {agreements.map((a) => {
            const v = latest(a);
            return (
              <li key={a.id}><div><Link className="title" href={`/dashboard/agreements/${a.id}`}>{a.title}</Link><small>v{v.version} · updated {formatDate(v.updatedAt)}{v.acceptedByName ? ` · accepted by ${v.acceptedByName}` : ''}</small></div><StatusChip value={v.status} tones={AGREEMENT_TONES} /></li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function PaymentsTab({ project, payments }: { project: Project; payments: Payment[]; agreements: Agreement[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="stack">
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => setAdding(true)}>+ Payment</button>
        <Link className="btn" href={`/dashboard/payments?project=${project.id}`}>Open in ledger</Link>
      </div>
      {payments.length === 0 ? <Empty title="No payments scheduled">Schedule them from the agreement (one per milestone) or add them here.</Empty>
        : <PaymentsTable rows={payments.map((p) => ({ payment: p, projectTitle: project.title, clientName: '' }))} showProject={false} />}
      <Modal open={adding} onClose={() => setAdding(false)} title="New payment">
        <PaymentForm projects={[project]} defaultProjectId={project.id} onDone={() => setAdding(false)} />
      </Modal>
    </div>
  );
}

export function DocumentsTab({ project, documents, payments }: { project: Project; documents: Doc[]; payments: Payment[] }) {
  const [adding, setAdding] = useState(false);
  const { run } = useAction();
  const { confirm } = useUi();
  const paymentOf = (id: string | null) => payments.find((p) => p.id === id);
  return (
    <div className="stack">
      <div className="actions"><button type="button" className="btn primary" onClick={() => setAdding(true)}>+ Document</button></div>
      <p className="notice info" style={{ margin: 0 }}>Share work-in-progress as view-only. Hold final, editable files until the linked payment is cleared — the list shows when a file is ready to release.</p>
      {documents.length === 0 ? <Empty title="No documents recorded" /> : (
        <div className="table-wrap">
          <table className="data stack-sm">
            <thead><tr><th>Document</th><th>Type</th><th>Shared</th><th>Release</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {documents.map((d) => {
                const pay = paymentOf(d.releaseAfterPaymentId);
                const s = pay ? summarisePayment(pay) : null;
                const cleared = s ? s.outstanding === 0 : true;
                return (
                  <tr key={d.id}>
                    <td data-label="Document"><strong>{d.name}</strong> <span className="mono">{d.version}</span>{d.note && <div className="faint" style={{ fontSize: '0.74rem' }}>{d.note}</div>}{d.link && <div><a href={d.link} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 400 }}>Open link</a></div>}</td>
                    <td data-label="Type">{label(d.type)}</td>
                    <td data-label="Shared">
                      <label className="check"><input type="checkbox" checked={d.sharedWithClient} onChange={(e) => run(() => updateDocument(d.id, { sharedWithClient: e.target.checked }))} /> {d.sharedWithClient ? 'Yes' : 'No'}</label>
                    </td>
                    <td data-label="Release">
                      {!d.locked ? <Chip tone="ok">Released {formatDate(d.releasedOn)}</Chip>
                        : cleared ? <Chip tone="info">Ready to release</Chip>
                          : <Chip tone="warn" title={pay?.label}>Held until {pay?.label} is paid ({formatINR(s?.outstanding)} due)</Chip>}
                    </td>
                    <td>
                      <div className="actions">
                        {d.locked && <button type="button" className={`btn small${cleared ? ' primary' : ''}`} onClick={async () => {
                          if (cleared || await confirm({ title: 'Release before payment?', message: `${pay?.label} still has ${formatINR(s?.outstanding)} outstanding. Releasing final files now removes your leverage.`, confirmLabel: 'Release anyway', danger: true })) run(() => releaseDocument(d.id, todayIST()), 'Released to client');
                        }}>Release</button>}
                        <button type="button" className="btn ghost small" aria-label={`Delete ${d.name}`} onClick={async () => { if (await confirm({ title: `Delete ${d.name}?`, message: 'The record is removed (no file is stored here).', confirmLabel: 'Delete', danger: true })) run(() => deleteDocument(d.id)); }}>✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Record a document">
        <DocumentForm projectId={project.id} payments={payments} onDone={() => setAdding(false)} />
      </Modal>
    </div>
  );
}

function DocumentForm({ projectId, payments, onDone }: { projectId: string; payments: Payment[]; onDone: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Doc['type']>('drawing');
  const [version, setVersion] = useState('v1');
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [locked, setLocked] = useState(true);
  const [payId, setPayId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const { run, busy } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('Name the document'); return; }
    const ok = await run(() => createDocument({ projectId, name: name.trim(), type, version: version.trim(), link: link.trim(), note: note.trim(), sharedWithClient: false, releasedOn: locked ? null : todayIST(), locked, releaseAfterPaymentId: payId || null }), 'Document recorded');
    if (ok) onDone();
  };
  return (
    <form onSubmit={submit} noValidate>
      <div className="form-grid">
        <Field label="Name *" error={err} className="full">{(id, d) => <input id={id} aria-describedby={d} value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} placeholder="e.g. Working drawings set" />}</Field>
        <Field label="Type">{(id) => <select id={id} value={type} onChange={(e) => setType(e.target.value as Doc['type'])}>{DocumentType.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select>}</Field>
        <Field label="Version">{(id) => <input id={id} value={version} onChange={(e) => setVersion(e.target.value)} />}</Field>
        <Field label="Link" hint="Drive/Dropbox link — files are not stored here" className="full">{(id, d) => <input id={id} aria-describedby={d} type="url" value={link} onChange={(e) => setLink(e.target.value)} />}</Field>
        <Field label="Note" className="full">{(id) => <input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <Field label="Release after payment">{(id) => <select id={id} value={payId} onChange={(e) => setPayId(e.target.value)}><option value="">— none —</option>{payments.map((p) => <option key={p.id} value={p.id}>{p.label} ({formatINR(p.amount)})</option>)}</select>}</Field>
        <div className="field"><span className="label">Status</span><label className="check"><input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} /> Hold final files (locked)</label></div>
      </div>
      <div className="form-actions"><button type="submit" className="btn primary" disabled={busy}>Save</button></div>
    </form>
  );
}
