/**
 * Seed rebasing: the sample data is written around a fixed anchor date. When
 * it is loaded, every date in it is moved by (today − anchor) days, so the
 * sample always shows something overdue, something due this week, etc.
 */
import { addDays, daysBetween } from '@/lib/format';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function rebaseDates<T>(value: T, anchor: string, today: string): T {
  const offset = daysBetween(anchor, today);
  if (offset === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (DATE.test(v)) return addDays(v, offset);
      if (DATETIME.test(v)) return new Date(Date.parse(v) + offset * 86_400_000).toISOString();
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
