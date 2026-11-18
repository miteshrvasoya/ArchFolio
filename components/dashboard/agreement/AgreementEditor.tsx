'use client';
import { nanoid } from 'nanoid';
import { useEffect, useState, type ReactNode } from 'react';
import { AgreementContentSchema, type AgreementContent, type Settings } from '@/lib/schemas';
import { saveDraft } from '@/lib/repositories';
import { checkMilestones, milestoneAmounts } from '@/lib/logic/milestones';
import { formatINR, formatNumber, parseRupees } from '@/lib/format';
import { AgreementDocument, DISCLAIMER } from '@/components/agreement/AgreementDocument';
import { useAction } from '../ui';

type C = AgreementContent;

/** Textarea bound to a string[] (one item per line), keeping what is typed. */
function LinesField({ id, label, value, onChange, rows = 4, hint }: { id: string; label: string; value: string[]; onChange: (v: string[]) => void; rows?: number; hint?: string }) {
  const [text, setText] = useState(value.join('\n'));
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} rows={rows} value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)); }} aria-describedby={hint ? `${id}-h` : undefined} />
      {hint && <span className="hint" id={`${id}-h`}>{hint}</span>}
    </div>
  );
}
/** Input bound to a comma-separated string[]. */
function ListInput({ id, label, value, onChange }: { id: string; label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <input id={id} value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean)); }} />
    </div>
  );
}
function Text({ id, label, value, onChange, type = 'text' }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}
function Area({ id, label, value, onChange, rows = 3 }: { id: string; label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return <div className="field"><label htmlFor={id}>{label}</label><textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}
function Section({ n, title, children, open = false, flag }: { n: number; title: string; children: ReactNode; open?: boolean; flag?: ReactNode }) {
  return <details open={open}><summary><span><span className="mono" style={{ color: 'var(--terra)' }}>{n}</span> {title}</span>{flag}</summary><div className="sec">{children}</div></details>;
}

export function AgreementEditor({ agreementId, versionId, title, version, initial, initialNote, settings, onSaved }: {
  agreementId: string; versionId: string; title: string; version: number; initial: C; initialNote: string; settings: Settings; onSaved?: () => void;
}) {
  const [c, setC] = useState<C>(initial);
  const [note, setNote] = useState(initialNote);
  const [fee, setFee] = useState(c.fees.totalFee ? formatNumber(c.fees.totalFee) : '');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const upd = (fn: (d: C) => void) => { setC((prev) => { const next = structuredClone(prev); fn(next); return next; }); setDirty(true); };
  const check = checkMilestones(c.fees.milestones);
  const amounts = milestoneAmounts(c.fees.totalFee, c.fees.milestones);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async () => {
    const parsed = AgreementContentSchema.safeParse(c);
    if (!parsed.success) { const i = parsed.error.issues[0]; setError(`${i?.path.join(' › ')}: ${i?.message}`); return; }
    if (!check.valid) { setError(`Fee schedule: ${check.message}`); return; }
    setError(null);
    const ok = await run(() => saveDraft(agreementId, versionId, parsed.data, note), 'Draft saved');
    if (ok) { setDirty(false); onSaved?.(); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void save(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const refreshFirm = () => upd((d) => {
    const f = settings.firm;
    d.parties.architect = { firmName: f.name, architectName: f.architectName, coaNumber: f.coaNumber, address: [f.address, f.city].filter(Boolean).join(', '), phone: f.phone, email: f.email, gstin: f.gstin };
  });

  return (
    <div className="editor">
      <div className="editor-form no-print">
        <div className="card" style={{ position: 'sticky', top: '3.9rem', zIndex: 5, display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className={dirty ? 'total-bad' : 'faint'} role="status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          <button type="button" className="btn primary" onClick={save} disabled={busy}>Save draft</button>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}

        <Section n={1} title="Parties" open>
          <h3 className="label">Architect / firm <button type="button" className="link-btn" onClick={refreshFirm}>refresh from Settings</button></h3>
          <div className="form-grid">
            <Text id="a-firm" label="Firm name" value={c.parties.architect.firmName} onChange={(v) => upd((d) => { d.parties.architect.firmName = v; })} />
            <Text id="a-arch" label="Architect" value={c.parties.architect.architectName} onChange={(v) => upd((d) => { d.parties.architect.architectName = v; })} />
            <Text id="a-coa" label="COA registration" value={c.parties.architect.coaNumber} onChange={(v) => upd((d) => { d.parties.architect.coaNumber = v; })} />
            <Text id="a-gst" label="GSTIN (optional)" value={c.parties.architect.gstin} onChange={(v) => upd((d) => { d.parties.architect.gstin = v; })} />
            <Text id="a-ph" label="Phone" value={c.parties.architect.phone} onChange={(v) => upd((d) => { d.parties.architect.phone = v; })} />
            <Text id="a-em" label="Email" value={c.parties.architect.email} onChange={(v) => upd((d) => { d.parties.architect.email = v; })} />
          </div>
          <Text id="a-ad" label="Address" value={c.parties.architect.address} onChange={(v) => upd((d) => { d.parties.architect.address = v; })} />
          <h3 className="label">Client</h3>
          <div className="form-grid">
            <Text id="c-name" label="Name" value={c.parties.client.name} onChange={(v) => upd((d) => { d.parties.client.name = v; })} />
            <Text id="c-ph" label="Phone" value={c.parties.client.phone} onChange={(v) => upd((d) => { d.parties.client.phone = v; })} />
            <Text id="c-em" label="Email" value={c.parties.client.email} onChange={(v) => upd((d) => { d.parties.client.email = v; })} />
            <Text id="c-ad" label="Address" value={c.parties.client.address} onChange={(v) => upd((d) => { d.parties.client.address = v; })} />
          </div>
        </Section>

        <Section n={2} title="Project summary">
          <div className="form-grid">
            <Text id="p-t" label="Project" value={c.project.title} onChange={(v) => upd((d) => { d.project.title = v; })} />
            <Text id="p-s" label="Site" value={c.project.site} onChange={(v) => upd((d) => { d.project.site = v; })} />
            <Text id="p-ty" label="Type" value={c.project.type} onChange={(v) => upd((d) => { d.project.type = v; })} />
            <Text id="p-a" label="Area" value={c.project.area} onChange={(v) => upd((d) => { d.project.area = v; })} />
          </div>
          <Area id="p-b" label="Brief" rows={4} value={c.project.brief} onChange={(v) => upd((d) => { d.project.brief = v; })} />
        </Section>

        <Section n={3} title="Scope and exclusions">
          <LinesField id="sc-in" label="Included" hint="One item per line" value={c.scope.included} onChange={(v) => upd((d) => { d.scope.included = v; })} rows={6} />
          <LinesField id="sc-ex" label="Not included" hint="Be explicit: structural, MEP, approvals, site supervision…" value={c.scope.exclusions} onChange={(v) => upd((d) => { d.scope.exclusions = v; })} rows={6} />
        </Section>

        <Section n={4} title="Phase-wise rollout">
          <table className="ms-table">
            <thead><tr><th>Phase</th><th>Start</th><th>End</th><th>Rev.</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {c.phases.map((p, i) => (
                <tr key={i}>
                  <td>
                    <input aria-label={`Phase ${i + 1} name`} value={p.name} onChange={(e) => upd((d) => { d.phases[i]!.name = e.target.value; })} />
                    <input aria-label={`Phase ${i + 1} deliverables`} placeholder="Deliverables, comma separated" value={p.deliverables.join(', ')} onChange={(e) => upd((d) => { d.phases[i]!.deliverables = e.target.value.split(',').map((s) => s.trimStart()).filter((s, j, arr) => s || j === arr.length - 1); })} onBlur={() => upd((d) => { d.phases[i]!.deliverables = d.phases[i]!.deliverables.map((s) => s.trim()).filter(Boolean); })} style={{ marginTop: '0.25rem' }} />
                  </td>
                  <td><input type="date" aria-label={`Phase ${i + 1} start`} value={p.start ?? ''} onChange={(e) => upd((d) => { d.phases[i]!.start = e.target.value || null; })} /></td>
                  <td><input type="date" aria-label={`Phase ${i + 1} end`} value={p.end ?? ''} onChange={(e) => upd((d) => { d.phases[i]!.end = e.target.value || null; })} /></td>
                  <td><input type="number" min={0} className="pct" aria-label={`Phase ${i + 1} revisions`} value={p.revisions} onChange={(e) => upd((d) => { d.phases[i]!.revisions = Math.max(0, Number(e.target.value) || 0); })} /></td>
                  <td className="nowrap">
                    <button type="button" className="btn ghost small" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => upd((d) => { const [x] = d.phases.splice(i, 1); d.phases.splice(i - 1, 0, x!); })}>↑</button>
                    <button type="button" className="btn ghost small" aria-label={`Remove ${p.name}`} onClick={() => upd((d) => { d.phases.splice(i, 1); })}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn small" onClick={() => upd((d) => { d.phases.push({ name: 'New phase', deliverables: [], start: null, end: null, revisions: 2 }); })}>+ Phase</button>
        </Section>

        <Section n={5} title="Timeline">
          <Text id="t-d" type="date" label="Overall deadline" value={c.timeline.overallDeadline ?? ''} onChange={(v) => upd((d) => { d.timeline.overallDeadline = v || null; })} />
          <Area id="t-dep" label="Dependency clause" rows={4} value={c.timeline.dependencyClause} onChange={(v) => upd((d) => { d.timeline.dependencyClause = v; })} />
          <Area id="t-ch" label="How changes revise the timeline" rows={4} value={c.timeline.changeClause} onChange={(v) => upd((d) => { d.timeline.changeClause = v; })} />
        </Section>

        <Section n={6} title="Fees and payment schedule" open flag={<span className={check.valid ? 'total-ok' : 'total-bad'}>{check.totalPercent}%</span>}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="f-total">Total fee (₹)</label>
              <input id="f-total" inputMode="numeric" value={fee} onChange={(e) => { setFee(e.target.value); const v = parseRupees(e.target.value); upd((d) => { d.fees.totalFee = v ?? 0; }); }} onBlur={() => setFee(c.fees.totalFee ? formatNumber(c.fees.totalFee) : '')} aria-describedby="f-total-h" />
              <span className="hint" id="f-total-h">{formatINR(c.fees.totalFee)} — e.g. 4,50,000 or 4.5 L</span>
            </div>
            <div className="field">
              <span className="label">GST</span>
              <label className="check"><input type="checkbox" checked={c.fees.gstEnabled} onChange={(e) => upd((d) => { d.fees.gstEnabled = e.target.checked; })} /> Add GST at</label>
              <input type="number" aria-label="GST rate percent" min={0} max={28} value={c.fees.gstRatePercent} disabled={!c.fees.gstEnabled} onChange={(e) => upd((d) => { d.fees.gstRatePercent = Math.max(0, Math.min(28, Number(e.target.value) || 0)); })} style={{ width: '5rem' }} />
            </div>
          </div>
          <table className="ms-table" aria-describedby="ms-total">
            <thead><tr><th>Milestone</th><th>Due when</th><th className="right">%</th><th className="right">Amount</th><th><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {c.fees.milestones.map((m, i) => (
                <tr key={m.id}>
                  <td><input aria-label={`Milestone ${i + 1} name`} value={m.label} onChange={(e) => upd((d) => { d.fees.milestones[i]!.label = e.target.value; })} /></td>
                  <td><input aria-label={`Milestone ${i + 1} trigger`} value={m.trigger} onChange={(e) => upd((d) => { d.fees.milestones[i]!.trigger = e.target.value; })} placeholder="e.g. On concept approval" /></td>
                  <td><input className="pct" type="number" min={0} max={100} step={1} aria-label={`Milestone ${i + 1} percent`} value={m.percent} onChange={(e) => upd((d) => { d.fees.milestones[i]!.percent = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))); })} /></td>
                  <td className="right mono nowrap">{formatINR(amounts[i] ?? 0)}</td>
                  <td><button type="button" className="btn ghost small" aria-label={`Remove ${m.label}`} onClick={() => upd((d) => { d.fees.milestones.splice(i, 1); })}>✕</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}><strong>Total</strong></td><td id="ms-total" className={`right mono ${check.valid ? 'total-ok' : 'total-bad'}`}>{check.totalPercent}%</td><td className="right mono">{formatINR(amounts.reduce((s, a) => s + a, 0))}</td><td /></tr></tfoot>
          </table>
          {!check.valid && <p className="total-bad" role="alert" style={{ fontSize: '0.8rem' }}>{check.message}</p>}
          <button type="button" className="btn small" onClick={() => upd((d) => { d.fees.milestones.push({ id: nanoid(8), label: 'Milestone', percent: Math.max(0, 100 - check.totalPercent), trigger: '' }); })}>+ Milestone</button>
          <ListInput id="f-modes" label="Payment modes" value={c.fees.paymentModes} onChange={(v) => upd((d) => { d.fees.paymentModes = v; })} />
          <Area id="f-late" label="Late payment terms" value={c.fees.latePaymentTerms} onChange={(v) => upd((d) => { d.fees.latePaymentTerms = v; })} />
        </Section>

        <Section n={7} title="Revisions and change requests">
          <div className="field">
            <label htmlFor="r-rate">Extra revision rate (₹ per revision)</label>
            <input id="r-rate" inputMode="numeric" value={c.revisions.extraRevisionRate || ''} onChange={(e) => upd((d) => { d.revisions.extraRevisionRate = parseRupees(e.target.value) ?? 0; })} />
          </div>
          <Area id="r-cl" label="Clause" rows={4} value={c.revisions.clause} onChange={(v) => upd((d) => { d.revisions.clause = v; })} />
        </Section>

        <Section n={8} title="Communication and approvals">
          <ListInput id="cm-ch" label="Official channels" value={c.communication.officialChannels} onChange={(v) => upd((d) => { d.communication.officialChannels = v; })} />
          <Area id="cm-rt" label="Response times" value={c.communication.responseTime} onChange={(v) => upd((d) => { d.communication.responseTime = v; })} />
          <Area id="cm-ap" label="What counts as approval" value={c.communication.approvalDefinition} onChange={(v) => upd((d) => { d.communication.approvalDefinition = v; })} />
        </Section>

        <Section n={9} title="Ownership and usage rights">
          <Area id="o-cl" label="Clause" rows={4} value={c.ownership.clause} onChange={(v) => upd((d) => { d.ownership.clause = v; })} />
          <label className="check"><input type="checkbox" checked={c.ownership.portfolioPermission} onChange={(e) => upd((d) => { d.ownership.portfolioPermission = e.target.checked; })} /> Client permits portfolio display</label>
        </Section>
        <Section n={10} title="Release of files"><Area id="fr" label="Clause" rows={4} value={c.fileRelease.clause} onChange={(v) => upd((d) => { d.fileRelease.clause = v; })} /></Section>
        <Section n={11} title="Cancellation / termination"><Area id="tm" label="Clause" rows={4} value={c.termination.clause} onChange={(v) => upd((d) => { d.termination.clause = v; })} /></Section>
        <Section n={12} title="Confidentiality, disputes, governing law">
          <Area id="l-c" label="Confidentiality" value={c.legal.confidentiality} onChange={(v) => upd((d) => { d.legal.confidentiality = v; })} />
          <Area id="l-d" label="Dispute resolution" rows={4} value={c.legal.disputeResolution} onChange={(v) => upd((d) => { d.legal.disputeResolution = v; })} />
          <Text id="l-g" label="Governing law" value={c.legal.governingLaw} onChange={(v) => upd((d) => { d.legal.governingLaw = v; })} />
        </Section>

        <div className="card">
          <Area id="v-note" label="Version note (what this version is / what changed)" rows={2} value={note} onChange={(v) => { setNote(v); setDirty(true); }} />
          <p className="disclaimer" style={{ marginTop: 0 }}>{DISCLAIMER}</p>
        </div>
      </div>
      <div className="editor-preview" aria-label="Live preview">
        <AgreementDocument content={c} title={title} version={version} branding={{ name: settings.firm.name, architectName: settings.firm.architectName, coaNumber: settings.firm.coaNumber, phone: settings.firm.phone, email: settings.firm.email, logoUrl: settings.firm.logoUrl }} showValidation />
      </div>
    </div>
  );
}
