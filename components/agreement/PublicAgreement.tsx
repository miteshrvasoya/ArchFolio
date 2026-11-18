'use client';
/**
 * Public agreement page. Shows ONLY the agreement version carried by the link
 * (or a published sample token) — never other dashboard data — and needs no
 * passcode.
 *
 * ACCEPTANCE IS A PLACEHOLDER UNTIL A BACKEND EXISTS: nothing is sent to or
 * stored on any server. The client gets a receipt (name, time, version and a
 * SHA-256 hash of exactly this content) to download or send back, and the
 * architect records it in the dashboard. The receipt is also kept in the
 * client's own browser so reopening the link shows it again.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { resolveAgreement, mailtoLink, whatsappLink, type ResolveResult, type SharedAgreement } from '@/lib/sharing';
import { contentHash } from '@/lib/sharing/hash';
import { receiptText, type AcceptanceReceipt } from '@/lib/sharing/receipt';
import { AgreementDocument, DISCLAIMER } from './AgreementDocument';

const receiptKey = (token: string) => `pln.acceptance.${token}`;

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

const REASONS: Record<string, string> = {
  'not-found': 'This agreement link is not valid. Please ask for a new link.',
  damaged: 'This link looks incomplete or damaged — it may have been cut off when it was copied. Please open the full link, or ask for it again.',
  mismatch: 'This link does not match the agreement it contains. Please ask for a new link.'
};

export function PublicAgreement({ token }: { token: string }) {
  const [res, setRes] = useState<ResolveResult | null>(null);
  const [receipt, setReceipt] = useState<AcceptanceReceipt | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      resolveAgreement(token, window.location.hash).then((r) => { if (alive) setRes(r); }).catch(() => { if (alive) setRes({ ok: false, reason: 'damaged' }); });
    };
    load();
    // a pasted link that differs only after "#" does not reload the page
    window.addEventListener('hashchange', load);
    try {
      const saved = localStorage.getItem(receiptKey(token));
      if (saved) setReceipt(JSON.parse(saved) as AcceptanceReceipt);
    } catch { /* storage blocked or bad data: ignore */ }
    return () => { alive = false; window.removeEventListener('hashchange', load); };
  }, [token]);

  if (!res) return <main className="pub"><div className="pub-center"><p role="status">Opening agreement…</p></div></main>;
  if (!res.ok) {
    return (
      <main className="pub">
        <div className="pub-center pub-panel" role="alert">
          <h2>Agreement unavailable</h2>
          <p>{REASONS[res.reason] ?? REASONS['not-found']}</p>
        </div>
      </main>
    );
  }
  return <Loaded data={res.data} receipt={receipt} onAccepted={setReceipt} />;
}

function Loaded({ data, receipt, onAccepted }: { data: SharedAgreement; receipt: AcceptanceReceipt | null; onAccepted: (r: AcceptanceReceipt) => void }) {
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const newer = data.latestVersion > data.version || data.status === 'superseded';
  const withdrawn = data.status === 'cancelled';
  const mine = receipt && receipt.versionId === data.versionId ? receipt : null;
  const canAccept = !newer && !withdrawn && !mine;

  const accept = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) { setError('Type your full name.'); return; }
    if (!agree) { setError('Tick the box to confirm you have read and agree.'); return; }
    setBusy(true);
    try {
      const r: AcceptanceReceipt = {
        kind: 'pln-acceptance', format: 1, token: data.token, agreementId: data.agreementId, versionId: data.versionId, version: data.version,
        title: data.title, acceptedByName: name.trim(), acceptedAt: new Date().toISOString(), contentHash: await contentHash(data.content)
      };
      try { localStorage.setItem(receiptKey(data.token), JSON.stringify(r)); } catch { /* fine: the receipt is shown below */ }
      onAccepted(r);
    } finally { setBusy(false); }
  };

  const text = mine ? receiptText(mine) : '';
  return (
    <main className="pub">
      <div className="pub-bar">
        <strong>{data.firm.name}</strong>
        <button type="button" className="pub-btn" onClick={() => window.print()}>Download / print PDF</button>
      </div>
      <div className="pub-wrap">
        {withdrawn && <div className="pub-banner danger" role="alert">This version of the agreement has been withdrawn by {data.firm.name}. Please ask for the current version.</div>}
        {!withdrawn && newer && <div className="pub-banner" role="alert">A newer version{data.latestVersion > data.version ? ` (version ${data.latestVersion})` : ''} of this agreement exists. Please ask {data.firm.name} for the latest link before accepting.</div>}
        <div className="pub-doc">
          <AgreementDocument content={data.content} title={data.title} version={data.version} branding={data.firm} issuedOn={data.issuedAt}
            acceptance={mine ? { name: mine.acceptedByName, at: mine.acceptedAt, hash: mine.contentHash } : null} />
        </div>

        {mine ? (
          <section className="pub-panel" aria-labelledby="rc-title">
            <h2 id="rc-title">Accepted — send your receipt</h2>
            <div className="pub-banner ok">You accepted version {mine.version} as <strong>{mine.acceptedByName}</strong>.</div>
            <p>Please send this receipt to {data.firm.name} so they can record your acceptance. It identifies exactly the text you accepted.</p>
            <div className="pub-receipt" aria-label="Acceptance receipt">{text}</div>
            <div className="pub-actions">
              {data.firm.phone && <a className="pub-btn primary" href={whatsappLink(data.firm.phone, text)} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>}
              {data.firm.email && <a className="pub-btn" href={mailtoLink(data.firm.email, `Agreement accepted: ${data.title} (v${data.version})`, text)}>Send by email</a>}
              <button type="button" className="pub-btn" onClick={() => download(`acceptance-${data.title.replace(/[^\w]+/g, '-').toLowerCase()}-v${data.version}.txt`, text)}>Download receipt</button>
              <button type="button" className="pub-btn" onClick={async () => { try { await navigator.clipboard.writeText(text); } catch { /* user can select the text */ } }}>Copy</button>
            </div>
            <p className="pub-note">Your acceptance is not stored online by this page; the receipt you send is the record.</p>
          </section>
        ) : canAccept ? (
          <section className="pub-panel" aria-labelledby="acc-title">
            <h2 id="acc-title">Accept this agreement</h2>
            <p>Please read the whole agreement above. If you agree, type your full name, tick the box and click Accept.</p>
            <form onSubmit={accept} noValidate>
              <div className="pub-field">
                <label htmlFor="acc-name">Your full name</label>
                <input id="acc-name" type="text" autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} aria-describedby={error ? 'acc-err' : undefined} />
              </div>
              <label className="pub-check"><input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setError(null); }} /> I have read and agree to this agreement (version {data.version}).</label>
              {error && <p className="pub-err" id="acc-err" role="alert">{error}</p>}
              <div className="pub-actions"><button type="submit" className="pub-btn primary" disabled={busy}>Accept</button></div>
            </form>
            <p className="pub-note">After accepting you will get a receipt to send back to {data.firm.name}. Nothing is uploaded from this page.</p>
          </section>
        ) : null}
        <p className="pub-note">{DISCLAIMER}</p>
      </div>
    </main>
  );
}
