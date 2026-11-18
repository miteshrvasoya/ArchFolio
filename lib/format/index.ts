/**
 * Formatting helpers. Money is integer rupees; dates are shown in IST as
 * "dd MMM yyyy". Calendar dates ("YYYY-MM-DD") are formatted from their parts
 * so no time-zone shift can move them a day.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const IST = 'Asia/Kolkata';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹12,34,567 — lakh/crore grouping. */
export function formatINR(rupees: number | null | undefined): string {
  if (rupees === null || rupees === undefined || !Number.isFinite(rupees)) return '—';
  return inr.format(Math.round(rupees));
}

/** 12,34,567 without the symbol (inputs, CSV). */
export function formatNumber(n: number): string {
  return num.format(n);
}

/** Compact: ₹4.5 L, ₹1.2 Cr. */
export function formatINRShort(rupees: number): string {
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? '−' : '';
  if (abs >= 1_00_00_000) return `${sign}₹${trim(abs / 1_00_00_000)} Cr`;
  if (abs >= 1_00_000) return `${sign}₹${trim(abs / 1_00_000)} L`;
  return formatINR(rupees);
}
const trim = (v: number) => (Math.round(v * 10) / 10).toString();

/** "YYYY-MM-DD" → "05 Mar 2026". Accepts a full ISO date-time too (shown in IST). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return formatDate(isoDateInIST(date));
}

/** ISO date-time → "05 Mar 2026, 4:30 pm" in IST. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
  return `${formatDate(isoDateInIST(date))}, ${time}`;
}

/** The calendar date of an instant, in IST, as "YYYY-MM-DD". */
export function isoDateInIST(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today in IST as "YYYY-MM-DD". */
export function todayIST(now: Date = new Date()): string {
  return isoDateInIST(now);
}

/** Whole days from a to b (both "YYYY-MM-DD"); positive when b is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86_400_000);
}

/** "YYYY-MM-DD" plus n days. */
export function addDays(date: string, days: number): string {
  const t = new Date(Date.UTC(...ymd(date)) + days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return [y ?? 1970, (m ?? 1) - 1, d ?? 1];
}

/** Relative wording for deadlines: "in 3 days", "today", "5 days ago". */
export function relativeDays(date: string | null, today: string = todayIST()): string {
  if (!date) return '';
  const d = daysBetween(today, date);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

/** "in-progress" → "In progress". */
export function label(value: string): string {
  const s = value.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Parse "1,50,000" / "150000" / "₹1.5 L" into integer rupees, or null. */
export function parseRupees(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/[₹,\s]/g, '');
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)(l|lakh|lac|cr|crore|k)?$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]);
  const mult = m[2] === 'cr' || m[2] === 'crore' ? 1_00_00_000 : m[2] && m[2].startsWith('l') ? 1_00_000 : m[2] === 'k' ? 1_000 : 1;
  return Math.round(v * mult);
}
