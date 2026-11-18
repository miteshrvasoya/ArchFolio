import { describe, expect, it } from 'vitest';
import type { Payment, Phase, Project } from '@/lib/schemas';
import { summarisePayment, totals } from './payments';
import { checkMilestones, milestoneAmounts, gstAmount } from './milestones';
import { cascadeShift, shiftPhaseDeadline, shiftProjectDeadline, slipDays } from './deadlines';
import { rebaseDates } from './seed';
import { addDays, daysBetween, formatDate, formatINR, formatINRShort, parseRupees } from '@/lib/format';

const pay = (o: Partial<Payment> = {}): Payment => ({
  id: 'p', projectId: 'x', agreementId: null, milestoneId: null, label: 'Fee', type: 'milestone',
  amount: 100000, dueDate: '2026-11-20', invoicedAt: null, receipts: [], notes: '', ...o
});
const receipt = (amount: number, date = '2026-11-10') => ({ id: `r${amount}`, date, amount, mode: 'upi' as const, reference: '', notes: '' });

describe('payment outstanding and overdue', () => {
  it('is pending before the due date with nothing received', () => {
    expect(summarisePayment(pay(), '2026-11-18')).toMatchObject({ received: 0, outstanding: 100000, status: 'pending', overdue: false });
  });
  it('is invoiced once a request was sent', () => {
    expect(summarisePayment(pay({ invoicedAt: '2026-11-15' }), '2026-11-18').status).toBe('invoiced');
  });
  it('is partially paid with some receipts', () => {
    expect(summarisePayment(pay({ receipts: [receipt(40000)] }), '2026-11-18')).toMatchObject({ received: 40000, outstanding: 60000, status: 'partially-paid' });
  });
  it('is overdue after the due date while anything is outstanding, even if part paid', () => {
    const s = summarisePayment(pay({ receipts: [receipt(40000)] }), '2026-11-25');
    expect(s).toMatchObject({ status: 'overdue', overdue: true, outstanding: 60000, daysOverdue: 5 });
  });
  it('is not overdue on the due date itself', () => {
    expect(summarisePayment(pay(), '2026-11-20').overdue).toBe(false);
  });
  it('is paid when receipts cover the amount, and never negative when overpaid', () => {
    expect(summarisePayment(pay({ receipts: [receipt(60000), receipt(50000)] }), '2026-12-30')).toMatchObject({ status: 'paid', outstanding: 0, overdue: false });
  });
  it('adds totals across payments', () => {
    const t = totals([pay({ receipts: [receipt(100000)] }), pay({ id: 'b', amount: 50000, dueDate: '2026-11-01' }), pay({ id: 'c', amount: 25000, receipts: [receipt(5000)] })], '2026-11-18');
    expect(t).toEqual({ billed: 175000, received: 105000, outstanding: 70000, overdue: 50000, overdueCount: 1 });
  });
});

describe('milestone percentages', () => {
  it('accepts a schedule that totals exactly 100%', () => {
    expect(checkMilestones([{ percent: 20 }, { percent: 30 }, { percent: 25 }, { percent: 25 }])).toEqual({ totalPercent: 100, valid: true, message: null });
  });
  it('reports what is missing or extra', () => {
    expect(checkMilestones([{ percent: 20 }, { percent: 30 }]).message).toMatch(/50% is unallocated/);
    expect(checkMilestones([{ percent: 60 }, { percent: 50 }]).message).toMatch(/10% too much/);
    expect(checkMilestones([]).valid).toBe(false);
    expect(checkMilestones([{ percent: 33.5 }, { percent: 66.5 }]).valid).toBe(false);
  });
  it('splits whole rupees and always sums to the total fee', () => {
    const amounts = milestoneAmounts(100001, [{ percent: 33 }, { percent: 33 }, { percent: 34 }]);
    expect(amounts.every(Number.isInteger)).toBe(true);
    expect(amounts.reduce((s, a) => s + a, 0)).toBe(100001);
    expect(milestoneAmounts(500000, [{ percent: 20 }, { percent: 30 }, { percent: 25 }, { percent: 25 }])).toEqual([100000, 150000, 125000, 125000]);
  });
  it('rejects fractional fees and computes GST', () => {
    expect(() => milestoneAmounts(10.5, [{ percent: 100 }])).toThrow();
    expect(gstAmount(500000, 18)).toBe(90000);
  });
});

const phase = (o: Partial<Phase>): Phase => ({
  id: 'a', projectId: 'p', name: 'Concept', description: '', deliverables: [], startDate: '2026-11-01', dueDate: '2026-11-20',
  originalDueDate: '2026-11-20', dueDateHistory: [], status: 'in-progress', revisionsAllowed: 2, revisionsUsed: 0, paymentMilestoneId: null, order: 0, ...o
});

describe('deadline shifts', () => {
  it('moves a phase by days, keeps the original date, and records why', () => {
    const p = shiftPhaseDeadline(phase({}), { byDays: 14, reason: 'Scope change', discussionId: 'd1', at: '2026-11-18T10:00:00.000Z' });
    expect(p.dueDate).toBe('2026-12-04');
    expect(p.originalDueDate).toBe('2026-11-20');
    expect(p.dueDateHistory).toEqual([{ changedAt: '2026-11-18T10:00:00.000Z', from: '2026-11-20', to: '2026-12-04', reason: 'Scope change', discussionId: 'd1' }]);
  });
  it('keeps the first original date across several moves', () => {
    const once = shiftPhaseDeadline(phase({}), { to: '2026-11-25', reason: 'a', at: 't' });
    const twice = shiftPhaseDeadline(once, { to: '2026-12-02', reason: 'b', at: 't' });
    expect(twice.originalDueDate).toBe('2026-11-20');
    expect(twice.dueDateHistory).toHaveLength(2);
    expect(slipDays(twice.originalDueDate, twice.dueDate)).toBe(12);
  });
  it('does nothing when the date does not change', () => {
    const p = phase({});
    expect(shiftPhaseDeadline(p, { to: '2026-11-20', reason: 'x', at: 't' })).toBe(p);
  });
  it('cascades day for day to later, unfinished phases only', () => {
    const list = [
      phase({ id: 'a', order: 0 }),
      phase({ id: 'b', order: 1, startDate: '2026-11-21', dueDate: '2026-12-10', originalDueDate: '2026-12-10' }),
      phase({ id: 'c', order: 2, dueDate: '2026-12-20', originalDueDate: '2026-12-20', status: 'delivered' })
    ];
    const moved = cascadeShift(list, 'a', 7, { reason: 'Client inputs late', at: 't' });
    expect(moved.map((p) => [p.id, p.startDate, p.dueDate])).toEqual([['b', '2026-11-28', '2026-12-17']]);
  });
  it('moves the project deadline the same way', () => {
    const project = { currentDeadline: '2027-01-15', originalDeadline: '2027-01-15', deadlineHistory: [] } as unknown as Project;
    const next = shiftProjectDeadline(project, { byDays: 21, reason: 'NOC delay', at: 't' });
    expect(next.currentDeadline).toBe('2027-02-05');
    expect(next.originalDeadline).toBe('2027-01-15');
  });
});

describe('dates, money and seed rebasing', () => {
  it('formats INR with lakh/crore grouping and no paise', () => {
    expect(formatINR(1234567)).toBe('₹12,34,567');
    expect(formatINRShort(4500000)).toBe('₹45 L');
    expect(formatINRShort(12500000)).toBe('₹1.3 Cr');
  });
  it('parses rupee input', () => {
    expect(parseRupees('1,50,000')).toBe(150000);
    expect(parseRupees('₹4.5 L')).toBe(450000);
    expect(parseRupees('abc')).toBeNull();
  });
  it('formats calendar dates without shifting them and datetimes in IST', () => {
    expect(formatDate('2026-03-05')).toBe('05 Mar 2026');
    expect(formatDate('2026-03-04T20:00:00Z')).toBe('05 Mar 2026'); // 01:30 IST next day
  });
  it('adds and counts days across month and year ends', () => {
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
    expect(daysBetween('2026-11-18', '2027-01-04')).toBe(47);
  });
  it('rebases every date in nested data and leaves other strings alone', () => {
    const out = rebaseDates({ a: '2026-11-18', b: ['2026-11-20T10:00:00+05:30'], c: 'not-a-date', d: 5 }, '2026-11-18', '2026-12-01');
    expect(out.a).toBe('2026-12-01');
    expect(out.b[0]).toBe('2026-12-03T04:30:00.000Z');
    expect(out.c).toBe('not-a-date');
    expect(out.d).toBe(5);
  });
});
