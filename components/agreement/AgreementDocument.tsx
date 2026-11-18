/**
 * The agreement as a document. One renderer for the editor's live preview,
 * the dashboard print view and the public client page, so what the client
 * sees is exactly what was drafted.
 */
import type { AgreementContent } from '@/lib/schemas';
import { checkMilestones, gstAmount, milestoneAmounts } from '@/lib/logic/milestones';
import { formatDate, formatDateTime, formatINR } from '@/lib/format';

export interface DocumentBranding {
  name: string;
  architectName: string;
  coaNumber: string;
  phone: string;
  email: string;
  logoUrl: string;
}

export interface DocumentAcceptance { name: string; at: string; hash?: string | null }

export const DISCLAIMER = 'Template for convenience; have a qualified advocate review before relying on it.';

export function AgreementDocument({ content: c, title, version, branding, acceptance, issuedOn, showValidation = false }: {
  content: AgreementContent;
  title: string;
  version: number;
  branding: DocumentBranding;
  acceptance?: DocumentAcceptance | null;
  issuedOn?: string | null;
  showValidation?: boolean;
}) {
  const check = checkMilestones(c.fees.milestones);
  const amounts = milestoneAmounts(c.fees.totalFee, c.fees.milestones);
  const gst = c.fees.gstEnabled ? gstAmount(c.fees.totalFee, c.fees.gstRatePercent) : 0;
  const a = c.parties.architect, cl = c.parties.client;
  const blank = (v: string, w = '12rem') => v ? v : <span className="agr-blank" style={{ minWidth: w }} aria-label="to be filled" />;

  return (
    <article className="agr-doc" aria-label={`${title}, version ${version}`}>
      <header className="agr-head">
        <div className="agr-brand">
          {/* the logo is any URL the architect pasted in Settings, so next/image cannot optimise it */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {branding.logoUrl ? <img src={branding.logoUrl} alt="" className="agr-logo" /> : <span className="agr-mark" aria-hidden="true"><span className="dot" />PLN</span>}
          <div>
            <strong>{branding.name}</strong>
            <span>{[branding.architectName, branding.coaNumber && `COA ${branding.coaNumber}`].filter(Boolean).join(' · ')}</span>
            <span>{[branding.phone, branding.email].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div className="agr-meta">
          <span>Agreement for architectural services</span>
          <span>Version {version}{issuedOn ? ` · ${formatDate(issuedOn)}` : ''}</span>
        </div>
      </header>
      <h1 className="agr-title">{title}</h1>

      <section className="agr-sec">
        <h2><span>1</span>Parties</h2>
        <div className="agr-parties">
          <div>
            <h3>Architect</h3>
            <p><strong>{blank(a.firmName)}</strong><br />{a.architectName}{a.coaNumber && <><br />Council of Architecture reg. {a.coaNumber}</>}<br />{a.address}<br />{[a.phone, a.email].filter(Boolean).join(' · ')}{a.gstin && <><br />GSTIN {a.gstin}</>}</p>
          </div>
          <div>
            <h3>Client</h3>
            <p><strong>{blank(cl.name)}</strong><br />{cl.address}<br />{[cl.phone, cl.email].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
      </section>

      <section className="agr-sec">
        <h2><span>2</span>Project summary</h2>
        <dl className="agr-kv">
          <dt>Project</dt><dd>{blank(c.project.title)}</dd>
          <dt>Site</dt><dd>{blank(c.project.site)}</dd>
          <dt>Type</dt><dd>{c.project.type || '—'}</dd>
          <dt>Area</dt><dd>{c.project.area || '—'}</dd>
        </dl>
        {c.project.brief && <p>{c.project.brief}</p>}
      </section>

      <section className="agr-sec">
        <h2><span>3</span>Scope of work</h2>
        <h3>Included</h3>
        {c.scope.included.length ? <ul>{c.scope.included.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="agr-muted">To be listed.</p>}
        <h3>Not included (unless added in writing)</h3>
        {c.scope.exclusions.length ? <ul>{c.scope.exclusions.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="agr-muted">None listed.</p>}
      </section>

      <section className="agr-sec">
        <h2><span>4</span>Phase-wise rollout</h2>
        {c.phases.length === 0 ? <p className="agr-muted">Phases to be agreed.</p> : (
          <table className="agr-table">
            <thead><tr><th>#</th><th>Phase</th><th>Deliverables</th><th>Start</th><th>End</th><th className="num">Revisions</th></tr></thead>
            <tbody>
              {c.phases.map((p, i) => (
                <tr key={i}><td>{i + 1}</td><td><strong>{p.name}</strong></td><td>{p.deliverables.join(', ') || '—'}</td><td className="nowrap">{formatDate(p.start)}</td><td className="nowrap">{formatDate(p.end)}</td><td className="num">{p.revisions}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="agr-sec">
        <h2><span>5</span>Timeline</h2>
        <p><strong>Overall completion:</strong> {c.timeline.overallDeadline ? formatDate(c.timeline.overallDeadline) : 'as per the phase dates above'}.</p>
        {c.timeline.dependencyClause && <p>{c.timeline.dependencyClause}</p>}
        {c.timeline.changeClause && <p>{c.timeline.changeClause}</p>}
      </section>

      <section className="agr-sec">
        <h2><span>6</span>Fees and payment schedule</h2>
        <p><strong>Total professional fee:</strong> {formatINR(c.fees.totalFee)}{c.fees.gstEnabled ? ` plus GST at ${c.fees.gstRatePercent}%` : ''}.</p>
        {showValidation && !check.valid && <p className="agr-warning" role="alert">{check.message}</p>}
        <table className="agr-table">
          <thead><tr><th>#</th><th>Milestone</th><th>Due</th><th className="num">%</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {c.fees.milestones.map((m, i) => (
              <tr key={m.id}><td>{i + 1}</td><td><strong>{m.label}</strong></td><td>{m.trigger}</td><td className="num">{m.percent}%</td><td className="num">{formatINR(amounts[i] ?? 0)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Total fee</td><td className={`num${check.valid ? '' : ' agr-bad'}`}>{check.totalPercent}%</td><td className="num">{formatINR(c.fees.totalFee)}</td></tr>
            {c.fees.gstEnabled && <tr><td colSpan={4}>GST @ {c.fees.gstRatePercent}%</td><td className="num">{formatINR(gst)}</td></tr>}
            {c.fees.gstEnabled && <tr><td colSpan={4}>Total including GST</td><td className="num">{formatINR(c.fees.totalFee + gst)}</td></tr>}
          </tfoot>
        </table>
        {c.fees.milestones[0] && <p><strong>Advance:</strong> {formatINR(amounts[0] ?? 0)} ({c.fees.milestones[0].percent}%) — {c.fees.milestones[0].trigger.toLowerCase()}.</p>}
        {c.fees.paymentModes.length > 0 && <p><strong>Payment modes:</strong> {c.fees.paymentModes.join(', ')}.</p>}
        {c.fees.latePaymentTerms && <p>{c.fees.latePaymentTerms}</p>}
      </section>

      <section className="agr-sec">
        <h2><span>7</span>Revisions and change requests</h2>
        {c.phases.length > 0 && <p>Included revisions: {c.phases.map((p) => `${p.name} — ${p.revisions}`).join('; ')}.</p>}
        {c.revisions.extraRevisionRate > 0 && <p>Additional revisions: {formatINR(c.revisions.extraRevisionRate)} per revision, or as quoted in writing.</p>}
        {c.revisions.clause && <p>{c.revisions.clause}</p>}
      </section>

      <section className="agr-sec">
        <h2><span>8</span>Communication and approvals</h2>
        {c.communication.officialChannels.length > 0 && <p><strong>Official channels:</strong> {c.communication.officialChannels.join(' and ')}. Decisions, approvals and changes are valid when confirmed on these channels.</p>}
        {c.communication.responseTime && <p>{c.communication.responseTime}</p>}
        {c.communication.approvalDefinition && <p>{c.communication.approvalDefinition}</p>}
      </section>

      <section className="agr-sec">
        <h2><span>9</span>Ownership and usage rights</h2>
        <p>{c.ownership.clause}</p>
        <p>{c.ownership.portfolioPermission
          ? 'The client permits the architect to show photographs and drawings of the project in the architect’s portfolio, website and publications, without disclosing the client’s personal details.'
          : 'The architect will not publish this project in a portfolio or publication without the client’s further written consent.'}</p>
      </section>

      <section className="agr-sec">
        <h2><span>10</span>Release of files</h2>
        <p>{c.fileRelease.clause}</p>
      </section>

      <section className="agr-sec">
        <h2><span>11</span>Cancellation and termination</h2>
        <p>{c.termination.clause}</p>
      </section>

      <section className="agr-sec">
        <h2><span>12</span>Confidentiality, disputes and governing law</h2>
        {c.legal.confidentiality && <p>{c.legal.confidentiality}</p>}
        {c.legal.disputeResolution && <p>{c.legal.disputeResolution}</p>}
        {c.legal.governingLaw && <p>{c.legal.governingLaw}</p>}
      </section>

      <section className="agr-sec agr-accept">
        <h2><span>13</span>Acceptance</h2>
        {acceptance ? (
          <div className="agr-accepted">
            <p><strong>Accepted by:</strong> {acceptance.name}</p>
            <p><strong>Accepted on:</strong> {formatDateTime(acceptance.at)} (IST)</p>
            {acceptance.hash && <p className="agr-hash"><strong>Content fingerprint (SHA-256):</strong> {acceptance.hash}</p>}
          </div>
        ) : (
          <div className="agr-sign">
            <div><span>Client name</span><span className="agr-blank" /></div>
            <div><span>Date</span><span className="agr-blank" /></div>
            <div><span>Accepted (typed name)</span><span className="agr-blank" /></div>
          </div>
        )}
        <p className="agr-muted">By accepting, the client confirms they have read and agree to this agreement, version {version}.</p>
      </section>

      <footer className="agr-foot">
        <span>{branding.name} · {title} · v{version}</span>
        <span>{DISCLAIMER}</span>
      </footer>
    </article>
  );
}
