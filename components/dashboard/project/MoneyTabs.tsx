'use client';
/** Project tabs for agreements, payments and documents. */
import Link from 'next/link';
import type { Agreement, Doc, Payment, Project } from '@/lib/schemas';
import { latest } from '@/lib/repositories';
import { summarisePayment } from '@/lib/logic/payments';
import { formatDate } from '@/lib/format';
import { Card, Empty, Money, StatusChip } from '../ui';
import { AGREEMENT_TONES, PAYMENT_TONES } from '../status';

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
  return (
    <Card title="Payments" action={<Link href={`/dashboard/payments?project=${project.id}`}>Open ledger</Link>}>
      {payments.length === 0 ? <p className="muted">No payments scheduled.</p> : (
        <ul className="list">
          {payments.map((p) => {
            const s = summarisePayment(p);
            return <li key={p.id}><div><strong>{p.label}</strong><small>due {formatDate(p.dueDate)} · received <Money value={s.received} /></small></div><span><Money value={p.amount} /> <StatusChip value={s.status} tones={PAYMENT_TONES} /></span></li>;
          })}
        </ul>
      )}
    </Card>
  );
}

export function DocumentsTab({ documents }: { project: Project; documents: Doc[]; payments: Payment[] }) {
  return (
    <Card title="Documents">
      {documents.length === 0 ? <p className="muted">No documents recorded.</p> : (
        <ul className="list">{documents.map((d) => <li key={d.id}><div><strong>{d.name} {d.version}</strong><small>{d.locked ? 'Held until payment' : `Released ${formatDate(d.releasedOn)}`}</small></div></li>)}</ul>
      )}
    </Card>
  );
}
