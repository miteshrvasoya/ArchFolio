/**
 * Snapshot-in-link: the agreement version (plus the firm branding needed to
 * render it) is serialised, compressed with lz-string and put in the URL hash.
 * The hash is never sent to a server, so the link works for any recipient with
 * no backend, and nothing else from the dashboard travels with it.
 *
 * Format:  s=<prefix><payload>   where prefix is "1." for format version 1.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { z } from 'zod';
import { AgreementContentSchema, AgreementVersionStatus, IsoDateTime } from '@/lib/schemas';

export const SNAPSHOT_FORMAT = 1;
/** Links longer than this may be cut off by some messengers and email clients. */
export const LONG_LINK_WARNING = 4000;
/** Refuse to even try decoding anything bigger (defence against hostile links). */
const MAX_ENCODED = 200_000;

export const SharedAgreementSchema = z.object({
  format: z.literal(SNAPSHOT_FORMAT),
  token: z.string().min(22).max(64),
  agreementId: z.string().min(1).max(64),
  versionId: z.string().min(1).max(64),
  version: z.number().int().min(1),
  /** number of the newest version when the link was made, for the "newer version" banner */
  latestVersion: z.number().int().min(1),
  status: AgreementVersionStatus,
  title: z.string().max(200),
  issuedAt: IsoDateTime,
  firm: z.object({
    name: z.string().max(160),
    architectName: z.string().max(120),
    coaNumber: z.string().max(60),
    phone: z.string().max(30),
    email: z.string().max(160),
    logoUrl: z.string().max(1000)
  }),
  content: AgreementContentSchema
});
export type SharedAgreement = z.infer<typeof SharedAgreementSchema>;

export function encodeSnapshot(data: SharedAgreement): string {
  const parsed = SharedAgreementSchema.parse(data);
  return `${SNAPSHOT_FORMAT}.${compressToEncodedURIComponent(JSON.stringify(parsed))}`;
}

export type DecodeResult =
  | { ok: true; data: SharedAgreement }
  | { ok: false; reason: 'empty' | 'too-large' | 'unknown-format' | 'corrupt' | 'invalid' };

export function decodeSnapshot(encoded: string | null | undefined): DecodeResult {
  if (!encoded) return { ok: false, reason: 'empty' };
  if (encoded.length > MAX_ENCODED) return { ok: false, reason: 'too-large' };
  const dot = encoded.indexOf('.');
  if (dot < 1 || encoded.slice(0, dot) !== String(SNAPSHOT_FORMAT)) return { ok: false, reason: 'unknown-format' };
  let json: unknown;
  try {
    const text = decompressFromEncodedURIComponent(encoded.slice(dot + 1));
    if (!text) return { ok: false, reason: 'corrupt' };
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  const parsed = SharedAgreementSchema.safeParse(json);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: 'invalid' };
}

/** Read the snapshot parameter out of a URL hash ("#s=..."). */
export function snapshotFromHash(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of h.split('&')) {
    const [k, ...rest] = part.split('=');
    if (k === 's') return rest.join('=');
  }
  return null;
}
