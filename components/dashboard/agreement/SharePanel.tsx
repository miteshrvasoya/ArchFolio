'use client';
/**
 * Share actions for one agreement version. The link carries a compressed
 * snapshot of just this version in its #hash (see lib/sharing), so it opens
 * for anyone with no server. Acceptance comes back as a receipt the client
 * sends; "Record acceptance" verifies it here (placeholder until a backend).
 */
import { useMemo, useState } from 'react';
import type { Agreement, AgreementVersion, Settings } from '@/lib/schemas';
import { markSent, markViewed, recordAcceptance } from '@/lib/repositories';
import { buildShareLink, mailtoLink, toShared, whatsappLink } from '@/lib/sharing';
import { parseReceipt } from '@/lib/sharing/receipt';
import { formatINR } from '@/lib/format';
import { Card, Modal, copyText, useAction, useUi } from '../ui';

export function SharePanel({ agreement, version, settings, clientPhone, clientEmail, feesValid }: {
  agreement: Agreement; version: AgreementVersion; settings: Settings; clientPhone: string; clientEmail: string; feesValid: boolean;
}) {
  const { confirm, toast } = useUi();
  const { run, busy } = useAction();
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptText, setReceiptText] = useState('');
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const link = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try { return buildShareLink(window.location.origin, toShared(agreement, version, settings)); } catch { return null; }
  }, [agreement, version, settings]);

  const canShare = version.status !== 'cancelled' && version.status !== 'superseded';
  const clientName = version.content.parties.client.name || 'there';
  const message = link ? [
    `Dear ${clientName},`,
    `Please find the agreement for ${version.content.project.title || agreement.title} (version ${version.version}) from ${settings.firm.name}:`,
    link.url,
    `Total fee: ${formatINR(version.content.fees.totalFee)}. Please read it fully; at the end, type your name and click Accept, then send me the acceptance receipt it shows.`,
    `— ${settings.firm.architectName || settings.firm.name}`
  ].join('\n\n') : '';

  /** Sharing a draft fixes it: it becomes "sent" and read-only. Returns the version to share. */
  const ensureSent = async (): Promise<AgreementVersion | null> => {
    if (!feesValid) { toast('Fix the fee schedule (it must total 100%) before sharing.', 'error'); return null; }
    if (version.status !== 'draft') return version;
    const ok = await confirm({ title: `Share version ${version.version}?`, message: 'Sharing marks this version as sent. It becomes read-only — later changes go into a new version, so the client always knows exactly what they accepted.', confirmLabel: 'Mark as sent and share' });
    if (!ok) return null;
    return (await run(() => markSent(agreement.id, version.id), 'Marked as sent')) ?? null;
  };

  const act = async (kind: 'copy' | 'whatsapp' | 'email' | 'open') => {
    if (!link) return;
    const sent = await ensureSent();
    if (!sent) return;
    // the version as it now stands (a draft just became "sent"), so the copied link matches the one shown
    const shared = sent === version ? link : buildShareLink(window.location.origin, toShared(agreement, sent, settings));
    const msg = message.replace(link.url, shared.url);
    if (kind === 'copy') {
      const copied = await copyText(shared.url);
      toast(copied ? 'Link copied' : 'Could not copy — select the link and copy it', copied ? 'info' : 'error');
    }
    if (kind === 'whatsapp') window.open(whatsappLink(clientPhone, msg), '_blank', 'noopener');
    if (kind === 'email') window.location.href = mailtoLink(clientEmail, `Agreement: ${agreement.title} (v${version.version})`, msg);
    if (kind === 'open') window.open(shared.url, '_blank', 'noopener');
  };

  const submitReceipt = async () => {
    const parsed = parseReceipt(receiptText);
    if (!parsed.ok) { setReceiptError(parsed.message); return; }
    const res = await run(() => recordAcceptance(parsed.receipt));
    if (!res) return;
    if (!res.ok) { setReceiptError(res.message); return; }
    toast(`Recorded: v${res.version} accepted by ${parsed.receipt.acceptedByName}`);
    setReceiptOpen(false); setReceiptText(''); setReceiptError(null);
  };

  return (
    <Card title="Share with client">
      {!canShare ? <p className="muted" style={{ marginTop: 0 }}>This version is {version.status}; it cannot be shared.</p> : (
        <div className="share-box">
          {!feesValid && <div className="notice" role="alert">The fee schedule must total 100% before this can be shared.</div>}
          {link && (
            <>
              <div className="share-url" aria-label="Share link">{link.url}</div>
              <span className="faint" style={{ fontSize: '0.72rem' }}>{link.length.toLocaleString('en-IN')} characters · the agreement travels inside the link</span>
              {link.tooLong && <div className="notice" role="status">This link is long ({link.length.toLocaleString('en-IN')} characters). It works in browsers, but some apps cut long links — if the client cannot open it, send the PDF as well.</div>}
            </>
          )}
          <div className="actions">
            <button type="button" className="btn primary small" disabled={busy || !link} onClick={() => act('copy')}>Copy link</button>
            <button type="button" className="btn small" disabled={busy || !link} onClick={() => act('whatsapp')}>WhatsApp</button>
            <button type="button" className="btn small" disabled={busy || !link} onClick={() => act('email')}>Email</button>
            <button type="button" className="btn small" disabled={busy || !link} onClick={() => act('open')}>Preview link</button>
            <button type="button" className="btn small" onClick={() => window.print()}>Print / PDF</button>
          </div>
          {version.status === 'sent' && <button type="button" className="link-btn" style={{ justifySelf: 'start' }} onClick={() => run(() => markViewed(agreement.id, version.id), 'Marked as viewed')}>Client has opened it → mark as viewed</button>}
          {version.status !== 'accepted' && (
            <button type="button" className="btn small" onClick={() => setReceiptOpen(true)}>Record acceptance…</button>
          )}
        </div>
      )}
      <Modal open={receiptOpen} onClose={() => setReceiptOpen(false)} title="Record acceptance">
        <p style={{ fontFamily: 'var(--f-text)', marginTop: 0 }}>Paste the acceptance receipt the client sent (WhatsApp message, email or the downloaded file). It is checked against this agreement before anything is recorded.</p>
        <p className="notice info">Placeholder until a backend exists: the client’s acceptance is not stored anywhere online — this receipt is the record.</p>
        <div className="field" data-invalid={receiptError ? 'true' : undefined}>
          <label htmlFor="receipt">Receipt</label>
          <textarea id="receipt" rows={7} value={receiptText} onChange={(e) => { setReceiptText(e.target.value); setReceiptError(null); }} placeholder="…Acceptance code: PLN-ACCEPTANCE-1:…" />
          {receiptError && <span className="err" role="alert">{receiptError}</span>}
        </div>
        <div className="field">
          <label htmlFor="receipt-file">…or open the receipt file</label>
          <input id="receipt-file" type="file" accept=".txt,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f && f.size < 100_000) setReceiptText(await f.text()); }} />
        </div>
        <div className="form-actions"><button type="button" className="btn primary" onClick={submitReceipt} disabled={!receiptText.trim() || busy}>Verify and record</button></div>
      </Modal>
    </Card>
  );
}
