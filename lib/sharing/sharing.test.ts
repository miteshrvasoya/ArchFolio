import { describe, expect, it } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import { decodeSnapshot, encodeSnapshot, snapshotFromHash, type SharedAgreement } from './snapshot';
import { buildShareLink, resolveAgreement, snapshotResolver, whatsappLink } from './index';
import { encodeReceipt, parseReceipt, receiptText, type AcceptanceReceipt } from './receipt';
import { canonicalJSON, contentHash } from './hash';
import templates from '@/data/seed/agreement-templates.json';
import { AgreementContentSchema } from '@/lib/schemas';

const content = AgreementContentSchema.parse(templates[0]!.content);
const shared: SharedAgreement = {
  format: 1, token: 'abcdefghijklmnopqrstuvwx', agreementId: 'a1', versionId: 'v1', version: 2, latestVersion: 3,
  status: 'sent', title: 'Agreement — Test', issuedAt: '2026-11-18T10:00:00.000Z',
  firm: { name: '.PLN architects', architectName: 'Ar. Test', coaNumber: 'CA/1', phone: '+91 90000 00000', email: 'a@example.com', logoUrl: '' },
  content
};

describe('share link snapshot', () => {
  it('round-trips encode → decode exactly', () => {
    const decoded = decodeSnapshot(encodeSnapshot(shared));
    expect(decoded).toEqual({ ok: true, data: shared });
  });
  it('builds a link with the token in the path and the snapshot in the hash', async () => {
    const link = buildShareLink('https://example.com/', shared);
    expect(link.url.startsWith('https://example.com/agreement/abcdefghijklmnopqrstuvwx#s=1.')).toBe(true);
    const hash = link.url.slice(link.url.indexOf('#'));
    expect(snapshotFromHash(hash)).toBe(encodeSnapshot(shared));
    const res = await resolveAgreement('abcdefghijklmnopqrstuvwx', hash, [snapshotResolver]);
    expect(res.ok && res.data.version).toBe(2);
    expect(link.tooLong).toBe(link.length > 4000);
  });
  it('rejects a snapshot whose token does not match the path', async () => {
    const hash = `#s=${encodeSnapshot(shared)}`;
    expect(await resolveAgreement('zzzzzzzzzzzzzzzzzzzzzzzz', hash, [snapshotResolver])).toEqual({ ok: false, reason: 'mismatch' });
  });
  it('fails gracefully on damaged, foreign or hostile input', () => {
    expect(decodeSnapshot('')).toEqual({ ok: false, reason: 'empty' });
    expect(decodeSnapshot('9.abc')).toEqual({ ok: false, reason: 'unknown-format' });
    expect(decodeSnapshot('1.%%%not-lz')).toMatchObject({ ok: false });
    expect(decodeSnapshot(`1.${compressToEncodedURIComponent('{"format":1}')}`)).toEqual({ ok: false, reason: 'invalid' });
    expect(decodeSnapshot(`1.${'A'.repeat(250_000)}`)).toEqual({ ok: false, reason: 'too-large' });
  });
});

describe('acceptance receipt', () => {
  it('hashes content canonically (key order does not matter)', async () => {
    expect(canonicalJSON({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(await contentHash({ b: 1, a: 2 })).toBe(await contentHash({ a: 2, b: 1 }));
    expect(await contentHash(content)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('round-trips through the receipt text a client sends back', async () => {
    const r: AcceptanceReceipt = {
      kind: 'pln-acceptance', format: 1, token: shared.token, agreementId: 'a1', versionId: 'v1', version: 2, title: shared.title,
      acceptedByName: 'Client Name', acceptedAt: '2026-11-18T12:00:00.000Z', contentHash: await contentHash(content)
    };
    const pasted = `Forwarded message\n${receiptText(r)}\nThanks!`;
    expect(parseReceipt(pasted)).toEqual({ ok: true, receipt: r });
    expect(parseReceipt(encodeReceipt(r))).toEqual({ ok: true, receipt: r });
    expect(parseReceipt('hello').ok).toBe(false);
    expect(parseReceipt('PLN-ACCEPTANCE-1:garbage').ok).toBe(false);
  });
  it('builds WhatsApp links with an Indian country code', () => {
    expect(whatsappLink('90000 11111', 'Hi')).toBe('https://wa.me/919000011111?text=Hi');
  });
});
