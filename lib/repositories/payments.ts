import { PaymentSchema, ReceiptSchema, type Payment, type Receipt } from '@/lib/schemas';
import { milestoneAmounts, checkMilestones } from '@/lib/logic/milestones';
import { formatINR } from '@/lib/format';
import { clientIdOfProject, DataError, getDb, logActivity, mustFind, mutate, newId } from './db';
import { current } from './agreements';

export type PaymentInput = Omit<Payment, 'id' | 'receipts'> & { receipts?: Receipt[] };
export type ReceiptInput = Omit<Receipt, 'id'>;

export async function getPayments(projectId?: string): Promise<Payment[]> {
  const all = (await getDb()).payments;
  return (projectId ? all.filter((p) => p.projectId === projectId) : [...all]).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
}
export async function getPayment(id: string): Promise<Payment | null> {
  return (await getDb()).payments.find((p) => p.id === id) ?? null;
}

export async function createPayment(input: PaymentInput): Promise<Payment> {
  const p = PaymentSchema.parse({ ...input, id: newId(), receipts: input.receipts ?? [] });
  return mutate((db) => {
    db.payments.push(p);
    logActivity(db, 'payment-created', `Payment scheduled: ${p.label} ${formatINR(p.amount)}`, p.projectId, clientIdOfProject(db, p.projectId));
    return p;
  });
}

export async function updatePayment(id: string, patch: Partial<Omit<PaymentInput, 'receipts'>>): Promise<Payment> {
  return mutate((db) => {
    const p = mustFind(db.payments, id, 'Payment');
    Object.assign(p, PaymentSchema.omit({ id: true, receipts: true }).partial().parse(patch));
    return p;
  });
}

export async function deletePayment(id: string): Promise<void> {
  await mutate((db) => {
    db.payments = db.payments.filter((p) => p.id !== id);
    db.documents.forEach((d) => { if (d.releaseAfterPaymentId === id) d.releaseAfterPaymentId = null; });
  });
}

export async function addReceipt(paymentId: string, input: ReceiptInput): Promise<Receipt> {
  const r = ReceiptSchema.parse({ ...input, id: newId() });
  return mutate((db) => {
    const p = mustFind(db.payments, paymentId, 'Payment');
    p.receipts.push(r);
    logActivity(db, 'payment-received', `${formatINR(r.amount)} received — ${p.label} (${r.mode.toUpperCase()}${r.reference ? ` ${r.reference}` : ''})`, p.projectId, clientIdOfProject(db, p.projectId));
    return r;
  });
}

export async function removeReceipt(paymentId: string, receiptId: string): Promise<void> {
  await mutate((db) => {
    const p = mustFind(db.payments, paymentId, 'Payment');
    p.receipts = p.receipts.filter((r) => r.id !== receiptId);
  });
}

/** Create one payment per milestone of the governing agreement version (skips milestones already scheduled). */
export async function schedulePaymentsFromAgreement(agreementId: string): Promise<number> {
  return mutate((db) => {
    const a = mustFind(db.agreements, agreementId, 'Agreement');
    const fees = current(a).content.fees;
    const check = checkMilestones(fees.milestones);
    if (!check.valid) throw new DataError(check.message ?? 'Fee schedule is invalid');
    const amounts = milestoneAmounts(fees.totalFee, fees.milestones);
    let created = 0;
    fees.milestones.forEach((m, i) => {
      if (db.payments.some((p) => p.agreementId === a.id && p.milestoneId === m.id)) return;
      db.payments.push(PaymentSchema.parse({
        id: newId(), projectId: a.projectId, agreementId: a.id, milestoneId: m.id, label: `${m.label} (${m.percent}%)`,
        type: i === 0 ? 'advance' : i === fees.milestones.length - 1 ? 'final' : 'milestone',
        amount: amounts[i] ?? 0, dueDate: null, invoicedAt: null, receipts: [], notes: m.trigger
      }));
      created += 1;
    });
    if (created) logActivity(db, 'payment-created', `${created} payment milestone${created > 1 ? 's' : ''} scheduled from ${a.title}`, a.projectId, clientIdOfProject(db, a.projectId));
    return created;
  });
}
