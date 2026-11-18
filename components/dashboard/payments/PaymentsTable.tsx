'use client';
/** Payments ledger table with receipts, used on /dashboard/payments and the project tab. */
import Link from 'next/link';
import { Fragment, useState, type FormEvent } from 'react';
import { PaymentMode, PaymentType, type Payment, type Project } from '@/lib/schemas';
import { addReceipt, createPayment, deletePayment, removeReceipt, updatePayment } from '@/lib/repositories';
import { summarisePayment, totals } from '@/lib/logic/payments';
import { formatDate, formatINR, formatNumber, label, parseRupees, todayIST } from '@/lib/format';
import { Field, Modal, Money, StatusChip, useAction, useUi } from '../ui';
import { PAYMENT_TONES } from '../status';

export interface LedgerRow { payment: Payment; projectTitle: string; clientName: string }

export function PaymentsTable({ rows, showProject = true }: { rows: LedgerRow[]; showProject?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<Payment | null>(null);
  const [editing, setEditing] = useState<Payment | null>(null);
  const { run } = useAction();
  const { confirm } = useUi();
  const today = todayIST();
  const t = totals(rows.map((r) => r.payment), today);

  return (
    <>
      <div className="table-wrap">
        <table className="data stack-sm">
          <caption className="sr-only">Payments</caption>
          <thead><tr>
            <th>Payment</th>{showProject && <th>Project</th>}<th>Due</th><th>Status</th>
            <th className="num">Amount</th><th className="num">Received</th><th className="num">Outstanding</th><th><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {rows.map(({ payment: p, projectTitle, clientName }) => {
              const s = summarisePayment(p, today);
              const expanded = open === p.id;
              return (
                <Fragment key={p.id}>
                  <tr className={s.overdue ? 'overdue' : ''}>
                    <td data-label="Payment">
                      <strong>{p.label}</strong>
                      <div className="faint" style={{ fontSize: '0.72rem' }}>{label(p.type)}{p.invoicedAt ? ` · requested ${formatDate(p.invoicedAt)}` : ''}</div>
                    </td>
                    {showProject && <td data-label="Project"><Link href={`/dashboard/projects/${p.projectId}?tab=payments`} style={{ fontWeight: 500 }}>{projectTitle}</Link><div className="faint" style={{ fontSize: '0.72rem' }}>{clientName}</div></td>}
                    <td data-label="Due">{formatDate(p.dueDate)}{s.overdue && <div className="total-bad" style={{ fontSize: '0.72rem' }}>{s.daysOverdue} days overdue</div>}</td>
                    <td data-label="Status"><StatusChip value={s.status} tones={PAYMENT_TONES} /></td>
                    <td data-label="Amount" className="num">{formatINR(p.amount)}</td>
                    <td data-label="Received" className="num">{formatINR(s.received)}</td>
                    <td data-label="Outstanding" className={`num${s.overdue ? ' total-bad' : ''}`}>{formatINR(s.outstanding)}</td>
                    <td>
                      <div className="actions" style={{ flexWrap: 'nowrap' }}>
                        {s.outstanding > 0 && <button type="button" className="btn primary small" onClick={() => setReceiptFor(p)}>Record receipt</button>}
                        <button type="button" className="btn ghost small" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} receipts for ${p.label}`} onClick={() => setOpen(expanded ? null : p.id)}>{p.receipts.length} ▾</button>
                        <button type="button" className="btn ghost small" aria-label={`Edit ${p.label}`} onClick={() => setEditing(p)}>Edit</button>
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={showProject ? 8 : 7} style={{ background: 'var(--bg-soft)' }}>
                        {p.receipts.length === 0 ? <span className="muted">No receipts yet.</span> : (
                          <ul className="list">
                            {p.receipts.map((r) => (
                              <li key={r.id}>
                                <span><strong className="mono">{formatINR(r.amount)}</strong> on {formatDate(r.date)} · {r.mode.toUpperCase()}{r.reference ? ` · ${r.reference}` : ''}{r.notes ? <small>{r.notes}</small> : null}</span>
                                <button type="button" className="btn ghost small" aria-label="Delete receipt" onClick={async () => { if (await confirm({ title: 'Delete this receipt?', message: `${formatINR(r.amount)} on ${formatDate(r.date)} will be removed and the outstanding amount goes up again.`, confirmLabel: 'Delete', danger: true })) run(() => removeReceipt(p.id, r.id), 'Receipt deleted'); }}>✕</button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {p.notes && <p className="muted" style={{ margin: '0.4rem 0 0' }}>{p.notes}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={showProject ? 4 : 3} data-label="Totals">Totals ({rows.length})</td>
              <td className="num" data-label="Billed">{formatINR(t.billed)}</td>
              <td className="num" data-label="Received">{formatINR(t.received)}</td>
              <td className={`num${t.overdue ? ' total-bad' : ''}`} data-label="Outstanding">{formatINR(t.outstanding)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <Modal open={!!receiptFor} onClose={() => setReceiptFor(null)} title={`Record receipt — ${receiptFor?.label ?? ''}`}>
        {receiptFor && <ReceiptForm payment={receiptFor} onDone={() => setReceiptFor(null)} />}
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit — ${editing?.label ?? ''}`}>
        {editing && <PaymentForm payment={editing} onDone={() => setEditing(null)} onDelete={async () => {
          if (await confirm({ title: `Delete ${editing.label}?`, message: 'The payment and its receipts are removed.', confirmLabel: 'Delete', danger: true })) {
            await run(() => deletePayment(editing.id), 'Payment deleted'); setEditing(null);
          }
        }} />}
      </Modal>
    </>
  );
}

export function ReceiptForm({ payment, onDone }: { payment: Payment; onDone: () => void }) {
  const s = summarisePayment(payment);
  const [amount, setAmount] = useState(formatNumber(s.outstanding));
  const [date, setDate] = useState(todayIST());
  const [mode, setMode] = useState<(typeof PaymentMode.options)[number]>('upi');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const { run, busy } = useAction();
  const { confirm } = useUi();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = parseRupees(amount);
    if (!v || v <= 0) { setErr('Enter the amount received, e.g. 75,000'); return; }
    if (v > s.outstanding && !(await confirm({ title: 'More than outstanding?', message: `${formatINR(v)} is more than the ${formatINR(s.outstanding)} outstanding. Record it anyway?`, confirmLabel: 'Record anyway' }))) return;
    const ok = await run(() => addReceipt(payment.id, { amount: v, date, mode, reference: reference.trim(), notes: notes.trim() }), `${formatINR(v)} recorded`);
    if (ok) onDone();
  };
  return (
    <form onSubmit={submit} noValidate>
      <p className="muted" style={{ marginTop: 0 }}>Amount {formatINR(payment.amount)} · received {formatINR(s.received)} · outstanding <strong>{formatINR(s.outstanding)}</strong></p>
      <div className="form-grid">
        <Field label="Amount received (₹) *" error={err}>{(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); setErr(null); }} autoFocus />}</Field>
        <Field label="Date">{(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Mode">{(id) => <select id={id} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>{PaymentMode.options.map((m) => <option key={m} value={m}>{m === 'upi' ? 'UPI' : label(m)}</option>)}</select>}</Field>
        <Field label="Reference no.">{(id) => <input id={id} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />}</Field>
        <Field label="Notes" className="full">{(id) => <input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
      <div className="form-actions"><button type="submit" className="btn primary" disabled={busy}>Record receipt</button></div>
    </form>
  );
}

export function PaymentForm({ payment, projects, defaultProjectId, onDone, onDelete }: { payment?: Payment; projects?: Project[]; defaultProjectId?: string; onDone: (p: Payment) => void; onDelete?: () => void }) {
  const [projectId, setProjectId] = useState(payment?.projectId ?? defaultProjectId ?? projects?.[0]?.id ?? '');
  const [labelText, setLabel] = useState(payment?.label ?? '');
  const [type, setType] = useState<Payment['type']>(payment?.type ?? 'milestone');
  const [amount, setAmount] = useState(payment ? formatNumber(payment.amount) : '');
  const [dueDate, setDueDate] = useState(payment?.dueDate ?? '');
  const [invoicedAt, setInvoicedAt] = useState(payment?.invoicedAt ?? '');
  const [notes, setNotes] = useState(payment?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = parseRupees(amount);
    const errs: Record<string, string> = {};
    if (!labelText.trim()) errs.label = 'What is this payment for?';
    if (v === null || v <= 0) errs.amount = 'Enter an amount, e.g. 1,50,000';
    if (!projectId) errs.project = 'Choose a project';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    const fields = { label: labelText.trim(), type, amount: v!, dueDate: dueDate || null, invoicedAt: invoicedAt || null, notes: notes.trim() };
    const saved = await run(() => (payment ? updatePayment(payment.id, fields) : createPayment({ ...fields, projectId, agreementId: null, milestoneId: null })), payment ? 'Payment updated' : 'Payment added');
    if (saved) onDone(saved);
  };
  return (
    <form onSubmit={submit} noValidate>
      <div className="form-grid">
        {!payment && projects && (
          <Field label="Project *" error={errors.project} className="full">{(id, d) => <select id={id} aria-describedby={d} value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>}</Field>
        )}
        <Field label="For *" error={errors.label} className="full">{(id, d) => <input id={id} aria-describedby={d} value={labelText} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Advance (20%), Extra revision" />}</Field>
        <Field label="Type">{(id) => <select id={id} value={type} onChange={(e) => setType(e.target.value as Payment['type'])}>{PaymentType.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select>}</Field>
        <Field label="Amount (₹) *" error={errors.amount}>{(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Due date">{(id) => <input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
        <Field label="Requested / invoiced on" hint="Marks it as invoiced">{(id, d) => <input id={id} aria-describedby={d} type="date" value={invoicedAt} onChange={(e) => setInvoicedAt(e.target.value)} />}</Field>
        <Field label="Notes" className="full">{(id) => <input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
      <div className="form-actions">
        {onDelete && <button type="button" className="btn danger" onClick={onDelete} style={{ marginRight: 'auto' }}>Delete payment</button>}
        <button type="submit" className="btn primary" disabled={busy}>{payment ? 'Save' : 'Add payment'}</button>
      </div>
    </form>
  );
}

export { Money };
