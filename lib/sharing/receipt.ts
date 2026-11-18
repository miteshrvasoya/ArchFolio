/**
 * Acceptance receipt — PLACEHOLDER UNTIL A BACKEND EXISTS.
 *
 * With no server, the public agreement page cannot store an acceptance
 * anywhere. Instead the client gets a receipt (name, time, version, content
 * hash) to download or send back by WhatsApp/email. The architect pastes it
 * into the dashboard ("Record acceptance"), which checks it against the
 * agreement version before marking it accepted. Nothing is stored remotely,
 * and a receipt is only as trustworthy as the channel it arrived through.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { z } from 'zod';
import { IsoDateTime } from '@/lib/schemas';

export const AcceptanceReceiptSchema = z.object({
  kind: z.literal('pln-acceptance'),
  format: z.literal(1),
  token: z.string().min(22).max(64),
  agreementId: z.string().min(1).max(64),
  versionId: z.string().min(1).max(64),
  version: z.number().int().min(1),
  title: z.string().max(200),
  acceptedByName: z.string().trim().min(2).max(160),
  acceptedAt: IsoDateTime,
  contentHash: z.string().regex(/^[0-9a-f]{64}$/)
});
export type AcceptanceReceipt = z.infer<typeof AcceptanceReceiptSchema>;

const MARK = 'PLN-ACCEPTANCE-1:';

/** Machine-readable code (one line) to paste back into the dashboard. */
export function encodeReceipt(r: AcceptanceReceipt): string {
  return MARK + compressToEncodedURIComponent(JSON.stringify(AcceptanceReceiptSchema.parse(r)));
}

/** Human-readable receipt text with the code at the end. */
export function receiptText(r: AcceptanceReceipt): string {
  return [
    `Agreement accepted: ${r.title} (version ${r.version})`,
    `Accepted by: ${r.acceptedByName}`,
    `Accepted at: ${r.acceptedAt}`,
    `Content hash (SHA-256): ${r.contentHash}`,
    '',
    'Acceptance code (paste into the dashboard to record it):',
    encodeReceipt(r)
  ].join('\n');
}

export type ParseReceiptResult = { ok: true; receipt: AcceptanceReceipt } | { ok: false; message: string };

/** Find and validate a receipt code anywhere in pasted text (e.g. a forwarded WhatsApp message). */
export function parseReceipt(text: string): ParseReceiptResult {
  const i = text.indexOf(MARK);
  if (i < 0) return { ok: false, message: 'No acceptance code found. Paste the whole receipt, including the line starting with PLN-ACCEPTANCE-1.' };
  const code = text.slice(i + MARK.length).trim().split(/\s/)[0] ?? '';
  if (code.length > 20_000) return { ok: false, message: 'That code is too long to be a receipt.' };
  try {
    const json = decompressFromEncodedURIComponent(code);
    if (!json) return { ok: false, message: 'The acceptance code is damaged — ask the client to send it again.' };
    const parsed = AcceptanceReceiptSchema.safeParse(JSON.parse(json));
    return parsed.success ? { ok: true, receipt: parsed.data } : { ok: false, message: 'The acceptance code is not valid.' };
  } catch {
    return { ok: false, message: 'The acceptance code is damaged — ask the client to send it again.' };
  }
}
