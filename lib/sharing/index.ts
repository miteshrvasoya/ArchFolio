/**
 * Agreement sharing without a backend, behind one interface.
 *
 * Resolution order for /agreement/[token]#s=...:
 *   1. Snapshot in the link — the agreement version travels compressed in the
 *      URL hash (never sent to a server). Works for any recipient.
 *   2. Published token lookup — tokens of the published sample agreements in
 *      data/seed resolve from JSON. This is where a future backend plugs in:
 *      add a resolver that fetches GET /api/agreements/by-token/:token.
 *
 * Revocation: with no server, a link already sent cannot be disabled; revoking
 * marks the version cancelled in the dashboard only (see docs/dashboard.md).
 */
import type { Agreement, AgreementVersion, Settings } from '@/lib/schemas';
import { encodeSnapshot, decodeSnapshot, snapshotFromHash, LONG_LINK_WARNING, type SharedAgreement } from './snapshot';

export type { SharedAgreement } from './snapshot';

export type ResolveResult =
  | { ok: true; data: SharedAgreement; source: 'snapshot' | 'published' }
  | { ok: false; reason: 'not-found' | 'mismatch' | 'damaged' };

export interface AgreementResolver {
  resolve(token: string, hash: string): Promise<ResolveResult | null>;
}

/** Build the shared payload for one version — only that version, nothing else. */
export function toShared(agreement: Agreement, version: AgreementVersion, settings: Settings): SharedAgreement {
  const latestVersion = agreement.versions.reduce((m, v) => Math.max(m, v.version), 0);
  return {
    format: 1,
    token: version.token,
    agreementId: agreement.id,
    versionId: version.id,
    version: version.version,
    latestVersion,
    status: version.status,
    title: agreement.title,
    // stable: the same version always produces the same link
    issuedAt: version.sentAt ?? version.createdAt,
    firm: {
      name: settings.firm.name, architectName: settings.firm.architectName, coaNumber: settings.firm.coaNumber,
      phone: settings.firm.phone, email: settings.firm.email, logoUrl: settings.firm.logoUrl
    },
    content: version.content
  };
}

export interface ShareLink { url: string; length: number; tooLong: boolean }

export function buildShareLink(origin: string, shared: SharedAgreement): ShareLink {
  const url = `${origin.replace(/\/$/, '')}/agreement/${encodeURIComponent(shared.token)}#s=${encodeSnapshot(shared)}`;
  return { url, length: url.length, tooLong: url.length > LONG_LINK_WARNING };
}

export const snapshotResolver: AgreementResolver = {
  async resolve(token, hash) {
    const encoded = snapshotFromHash(hash);
    if (!encoded) return null;
    const decoded = decodeSnapshot(encoded);
    if (!decoded.ok) return { ok: false, reason: 'damaged' };
    if (decoded.data.token !== token) return { ok: false, reason: 'mismatch' };
    return { ok: true, data: decoded.data, source: 'snapshot' };
  }
};

/** Published sample agreements (fake data shipped in the bundle). */
export const publishedResolver: AgreementResolver = {
  async resolve(token) {
    const [{ sampleDatabase }] = await Promise.all([import('@/lib/storage/sample')]);
    const db = await sampleDatabase();
    for (const a of db.agreements) {
      const v = a.versions.find((x) => x.token === token);
      if (v) return { ok: true, data: toShared(a, v, db.settings), source: 'published' };
    }
    return null;
  }
};

export async function resolveAgreement(token: string, hash: string, resolvers: AgreementResolver[] = [snapshotResolver, publishedResolver]): Promise<ResolveResult> {
  let failure: ResolveResult | null = null;
  for (const r of resolvers) {
    const res = await r.resolve(token, hash);
    if (res?.ok) return res;
    if (res && !failure) failure = res;
  }
  return failure ?? { ok: false, reason: 'not-found' };
}

/** wa.me link with a prefilled message. */
export function whatsappLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  const num = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}

export function mailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
