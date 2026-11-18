/**
 * Payment maths. Nothing here is stored: received, outstanding, status and
 * overdue are always computed from the payment and its receipts.
 */
import type { Payment, PaymentStatus } from '@/lib/schemas';
import { todayIST } from '@/lib/format';

export interface PaymentSummary {
  received: number;
  outstanding: number;
  status: PaymentStatus;
  overdue: boolean;
  /** days past due (0 when not overdue) */
  daysOverdue: number;
}

export function summarisePayment(p: Payment, today: string = todayIST()): PaymentSummary {
  const received = p.receipts.reduce((s, r) => s + r.amount, 0);
  const outstanding = Math.max(0, p.amount - received);
  const overdue = outstanding > 0 && p.dueDate !== null && p.dueDate < today;
  const daysOverdue = overdue && p.dueDate ? Math.round((Date.parse(today) - Date.parse(p.dueDate)) / 86_400_000) : 0;
  let status: PaymentStatus;
  if (outstanding === 0 && p.amount > 0) status = 'paid';
  else if (overdue) status = 'overdue';
  else if (received > 0) status = 'partially-paid';
  else if (p.invoicedAt) status = 'invoiced';
  else status = 'pending';
  return { received, outstanding, status, overdue, daysOverdue };
}

export interface Totals {
  billed: number;
  received: number;
  outstanding: number;
  overdue: number;
  overdueCount: number;
}

export function totals(payments: Payment[], today: string = todayIST()): Totals {
  return payments.reduce<Totals>((t, p) => {
    const s = summarisePayment(p, today);
    t.billed += p.amount;
    t.received += s.received;
    t.outstanding += s.outstanding;
    if (s.overdue) { t.overdue += s.outstanding; t.overdueCount += 1; }
    return t;
  }, { billed: 0, received: 0, outstanding: 0, overdue: 0, overdueCount: 0 });
}
