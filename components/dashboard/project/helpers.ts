export { addDays, daysBetween, formatDate, label, todayIST } from '@/lib/format';
export const splitListSafe = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);
