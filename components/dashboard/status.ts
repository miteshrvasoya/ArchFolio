import type { Tone } from './ui';

export const CLIENT_TONES: Record<string, Tone> = { lead: 'info', active: 'ok', past: 'neutral', dormant: 'warn' };
export const PROJECT_TONES: Record<string, Tone> = {
  inquiry: 'info', 'agreement-pending': 'warn', 'in-progress': 'ok', 'on-hold': 'warn', delivered: 'terra', closed: 'neutral', cancelled: 'danger'
};
export const PHASE_TONES: Record<string, Tone> = {
  'not-started': 'neutral', 'in-progress': 'info', 'in-review': 'warn', revision: 'warn', approved: 'ok', delivered: 'ok'
};
export const AGREEMENT_TONES: Record<string, Tone> = {
  draft: 'neutral', sent: 'info', viewed: 'info', accepted: 'ok', superseded: 'neutral', cancelled: 'danger'
};
export const PAYMENT_TONES: Record<string, Tone> = {
  pending: 'neutral', invoiced: 'info', 'partially-paid': 'warn', paid: 'ok', overdue: 'danger'
};
export const TASK_TONES: Record<string, Tone> = { todo: 'neutral', doing: 'info', blocked: 'danger', done: 'ok' };
export const PRIORITY_TONES: Record<string, Tone> = { low: 'neutral', medium: 'warn', high: 'danger' };

export const CHANNEL_LABEL: Record<string, string> = { call: 'Call', whatsapp: 'WhatsApp', meeting: 'Meeting', email: 'Email', 'site-visit': 'Site visit' };
