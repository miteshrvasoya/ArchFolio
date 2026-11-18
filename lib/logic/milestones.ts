/**
 * Fee schedule maths: percentages must total exactly 100, and amounts are
 * split in whole rupees with the rounding difference carried by the last
 * milestone, so the amounts always add up to the total fee.
 */
import type { Milestone } from '@/lib/schemas';

export interface MilestoneCheck {
  totalPercent: number;
  valid: boolean;
  message: string | null;
}

export function checkMilestones(milestones: Pick<Milestone, 'percent'>[]): MilestoneCheck {
  const totalPercent = milestones.reduce((s, m) => s + m.percent, 0);
  if (!milestones.length) return { totalPercent, valid: false, message: 'Add at least one payment milestone.' };
  if (milestones.some((m) => !Number.isInteger(m.percent) || m.percent < 0)) {
    return { totalPercent, valid: false, message: 'Percentages must be whole numbers.' };
  }
  if (totalPercent !== 100) {
    const diff = 100 - totalPercent;
    return { totalPercent, valid: false, message: diff > 0 ? `Milestones add up to ${totalPercent}% — ${diff}% is unallocated.` : `Milestones add up to ${totalPercent}% — ${-diff}% too much.` };
  }
  return { totalPercent, valid: true, message: null };
}

/** Whole-rupee amount for each milestone; the last one absorbs rounding. */
export function milestoneAmounts(totalFee: number, milestones: Pick<Milestone, 'percent'>[]): number[] {
  if (!Number.isInteger(totalFee) || totalFee < 0) throw new Error('Total fee must be a whole number of rupees');
  const amounts = milestones.map((m) => Math.floor((totalFee * m.percent) / 100));
  const pct = milestones.reduce((s, m) => s + m.percent, 0);
  if (pct === 100 && amounts.length) {
    const diff = totalFee - amounts.reduce((s, a) => s + a, 0);
    amounts[amounts.length - 1] = (amounts[amounts.length - 1] ?? 0) + diff;
  }
  return amounts;
}

/** GST on a fee, whole rupees. */
export function gstAmount(fee: number, ratePercent: number): number {
  return Math.round((fee * ratePercent) / 100);
}
