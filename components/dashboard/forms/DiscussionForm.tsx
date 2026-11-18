'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { Channel, DiscussionSchema, type Discussion, type Phase, type Project } from '@/lib/schemas';
import { logDiscussion, type DiscussionInput } from '@/lib/repositories';
import { parseWhatsApp } from '@/lib/logic/whatsapp';
import { addDays, daysBetween, formatDate, formatINR, localISTToIso, nowLocalIST, isoToLocalIST, parseRupees } from '@/lib/format';
import { CHANNEL_LABEL } from '../status';
import { Field, issuesToErrors, splitLines, useAction } from '../ui';

interface ItemRow { text: string; owner: string; due: string }
interface AttRow { name: string; type: DiscussionInput['attachments'][number]['type']; link: string; note: string }

/**
 * Log a discussion. "Scope / reference change" is first-class: record the time
 * and cost impact, and optionally move a phase deadline in the same step
 * (original vs revised date shown, later phases can follow day for day).
 */
export function DiscussionForm({ projects, phases, projectId, scopeChange: initialScope = false, onDone }: {
  projects: Project[]; phases: Phase[]; projectId?: string; scopeChange?: boolean; onDone: (d: Discussion) => void;
}) {
  const [pid, setPid] = useState(projectId ?? projects[0]?.id ?? '');
  const [at, setAt] = useState(nowLocalIST());
  const [channel, setChannel] = useState<DiscussionInput['channel']>('whatsapp');
  const [summary, setSummary] = useState('');
  const [decisions, setDecisions] = useState('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [atts, setAtts] = useState<AttRow[]>([]);
  const [tags, setTags] = useState('');
  const [scope, setScope] = useState(initialScope);
  const [impactDays, setImpactDays] = useState('');
  const [impactCost, setImpactCost] = useState('');
  const [impactNotes, setImpactNotes] = useState('');
  const [moveDeadline, setMoveDeadline] = useState(initialScope);
  const [phaseId, setPhaseId] = useState('');
  const [newDue, setNewDue] = useState('');
  const [cascade, setCascade] = useState(true);
  const [moveProject, setMoveProject] = useState(true);
  const [paste, setPaste] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();

  const projectPhases = useMemo(() => phases.filter((p) => p.projectId === pid && p.status !== 'delivered' && p.status !== 'approved').sort((a, b) => a.order - b.order), [phases, pid]);
  const phase = projectPhases.find((p) => p.id === phaseId) ?? projectPhases[0];
  const days = Number(impactDays) || 0;
  const proposedDue = newDue || (phase?.dueDate && days ? addDays(phase.dueDate, days) : phase?.dueDate ?? '');

  const importChat = () => {
    const draft = parseWhatsApp(paste);
    if (!draft.summary) return;
    setSummary((s) => (s ? `${s}\n\n${draft.summary}` : draft.summary));
    if (draft.firstAt) setAt(isoToLocalIST(draft.firstAt));
    setChannel('whatsapp');
    setAtts((a) => [...a, { name: 'WhatsApp chat (pasted)', type: 'whatsapp-export', link: '', note: `${draft.messages.length} messages${draft.participants.length ? ` · ${draft.participants.join(', ')}` : ''}` }]);
    setPaste('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cost = impactCost.trim() ? parseRupees(impactCost) : 0;
    const input: DiscussionInput = {
      projectId: pid, at: localISTToIso(at), channel, summary: summary.trim(), decisions: splitLines(decisions),
      actionItems: items.filter((i) => i.text.trim()).map((i) => ({ id: '', text: i.text.trim(), owner: i.owner.trim(), due: i.due || null, done: false })),
      attachments: atts.filter((a) => a.name.trim()).map((a) => ({ ...a, name: a.name.trim() })),
      scopeChange: scope,
      impact: scope || days || cost ? { days, costInr: cost ?? 0, notes: impactNotes.trim() } : null,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean)
    };
    const errs: Record<string, string> = {};
    const check = DiscussionSchema.omit({ id: true }).safeParse({ ...input, actionItems: input.actionItems.map((a) => ({ ...a, id: 'x' })) });
    if (!check.success) Object.assign(errs, issuesToErrors(check.error.issues));
    if (!pid) errs.projectId = 'Choose a project';
    if (impactCost.trim() && cost === null) errs.impactCost = 'Enter an amount like 50,000';
    if (scope && moveDeadline) {
      if (!phase) errs.phase = 'This project has no open phase to move';
      else if (!proposedDue) errs.newDue = 'Choose the revised date';
    }
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    const deadline = scope && moveDeadline && phase && proposedDue
      ? { phaseId: phase.id, to: proposedDue, reason: impactNotes.trim() || summary.trim().slice(0, 160) || 'Scope change', cascade, moveProject }
      : undefined;
    const saved = await run(() => logDiscussion(input, deadline), scope ? 'Scope change logged' : 'Discussion logged');
    if (saved) onDone(saved);
  };

  const shift = phase?.dueDate && proposedDue ? daysBetween(phase.dueDate, proposedDue) : 0;

  return (
    <form onSubmit={submit} noValidate>
      {Object.keys(errors).length > 0 && <div className="form-error" role="alert">Please fix the highlighted fields.</div>}
      <div className="form-grid">
        {!projectId && (
          <Field label="Project *" error={errors.projectId} className="full">{(id, d) => (
            <select id={id} aria-describedby={d} value={pid} onChange={(e) => { setPid(e.target.value); setPhaseId(''); setNewDue(''); }}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          )}</Field>
        )}
        <Field label="Date & time (IST)">{(id) => <input id={id} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}</Field>
        <Field label="Channel">{(id) => <select id={id} value={channel} onChange={(e) => setChannel(e.target.value as DiscussionInput['channel'])}>{Channel.options.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select>}</Field>
      </div>

      <details style={{ marginBottom: '0.8rem' }}>
        <summary className="label" style={{ cursor: 'pointer' }}>Paste a WhatsApp chat</summary>
        <div className="field" style={{ marginTop: '0.5rem' }}>
          <label htmlFor="wa-paste" className="sr-only">WhatsApp chat text</label>
          <textarea id="wa-paste" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'[18/11/26, 10:45 AM] Client: Can we add a terrace garden?\n…'} />
          <span className="hint">Export the chat (or copy the messages) and paste it here. It becomes the summary; add decisions below.</span>
        </div>
        <button type="button" className="btn small" onClick={importChat} disabled={!paste.trim()}>Use this chat</button>
      </details>

      <Field label="Summary *" error={errors.summary}>{(id, d) => <textarea id={id} aria-describedby={d} rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was discussed, in plain words" />}</Field>
      <Field label="Decisions" hint="One per line">{(id, d) => <textarea id={id} aria-describedby={d} rows={3} value={decisions} onChange={(e) => setDecisions(e.target.value)} />}</Field>

      <fieldset className="field" style={{ border: 0, padding: 0 }}>
        <legend className="label">Action items</legend>
        <div className="repeat">
          {items.map((it, i) => (
            <div key={i} className="repeat-row">
              <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
                <input aria-label={`Action ${i + 1}`} placeholder="What needs doing" value={it.text} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} />
                <input aria-label={`Action ${i + 1} owner`} placeholder="Owner" value={it.owner} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, owner: e.target.value } : y)))} />
                <input aria-label={`Action ${i + 1} due`} type="date" value={it.due} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, due: e.target.value } : y)))} />
              </div>
              <button type="button" className="btn ghost small" aria-label={`Remove action ${i + 1}`} onClick={() => setItems((x) => x.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
        <div><button type="button" className="btn small" onClick={() => setItems((x) => [...x, { text: '', owner: '', due: '' }])}>+ Action item</button></div>
      </fieldset>

      <fieldset className="field" style={{ border: 0, padding: 0 }}>
        <legend className="label">Attachments & evidence</legend>
        <div className="repeat">
          {atts.map((a, i) => (
            <div key={i} className="repeat-row">
              <div className="form-grid" style={{ gridTemplateColumns: '1.3fr 1fr 1.3fr' }}>
                <input aria-label={`Attachment ${i + 1} name`} placeholder="Name, e.g. Call recording" value={a.name} onChange={(e) => setAtts((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                <select aria-label={`Attachment ${i + 1} type`} value={a.type} onChange={(e) => setAtts((x) => x.map((y, j) => (j === i ? { ...y, type: e.target.value as AttRow['type'] } : y)))}>
                  {['call-recording', 'whatsapp-export', 'photo', 'drawing', 'document', 'link', 'other'].map((t) => <option key={t} value={t}>{t.replace('-', ' ')}</option>)}
                </select>
                <input aria-label={`Attachment ${i + 1} link or note`} placeholder="Link, or where it is saved" value={a.link || a.note} onChange={(e) => setAtts((x) => x.map((y, j) => (j === i ? (/^https?:/.test(e.target.value) ? { ...y, link: e.target.value, note: '' } : { ...y, note: e.target.value, link: '' }) : y)))} />
              </div>
              <button type="button" className="btn ghost small" aria-label={`Remove attachment ${i + 1}`} onClick={() => setAtts((x) => x.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
        <div><button type="button" className="btn small" onClick={() => setAtts((x) => [...x, { name: '', type: 'call-recording', link: '', note: '' }])}>+ Attachment</button></div>
      </fieldset>

      <div className="card" style={{ background: scope ? 'var(--terra-faint)' : undefined, marginBottom: '0.8rem' }}>
        <label className="check"><input type="checkbox" checked={scope} onChange={(e) => { setScope(e.target.checked); setMoveDeadline(e.target.checked); }} /> <strong>This changes the scope or references</strong></label>
        {scope && (
          <div style={{ marginTop: '0.75rem' }}>
            <div className="form-grid">
              <Field label="Time impact (days)">{(id) => <input id={id} type="number" inputMode="numeric" value={impactDays} onChange={(e) => { setImpactDays(e.target.value); setNewDue(''); }} />}</Field>
              <Field label="Cost impact (₹)" error={errors.impactCost}>{(id, d) => <input id={id} aria-describedby={d} value={impactCost} onChange={(e) => setImpactCost(e.target.value)} placeholder="e.g. 50,000" />}</Field>
              <Field label="What changed / impact notes" className="full">{(id) => <input id={id} value={impactNotes} onChange={(e) => setImpactNotes(e.target.value)} placeholder="Also used as the reason for the deadline change" />}</Field>
            </div>
            <label className="check"><input type="checkbox" checked={moveDeadline} onChange={(e) => setMoveDeadline(e.target.checked)} /> Adjust a phase deadline</label>
            {moveDeadline && (
              <div style={{ marginTop: '0.6rem' }}>
                {projectPhases.length === 0 ? <p className="muted" role="alert">{errors.phase ?? 'No open phases on this project.'}</p> : (
                  <>
                    <div className="form-grid">
                      <Field label="Phase" error={errors.phase}>{(id, d) => (
                        <select id={id} aria-describedby={d} value={phase?.id ?? ''} onChange={(e) => { setPhaseId(e.target.value); setNewDue(''); }}>
                          {projectPhases.map((p) => <option key={p.id} value={p.id}>{p.name} — due {formatDate(p.dueDate)}</option>)}
                        </select>
                      )}</Field>
                      <Field label="Revised due date" error={errors.newDue}>{(id, d) => <input id={id} aria-describedby={d} type="date" value={proposedDue} onChange={(e) => setNewDue(e.target.value)} />}</Field>
                    </div>
                    {phase && proposedDue && (
                      <p className="impact">
                        <strong>{phase.name}:</strong> original {formatDate(phase.originalDueDate ?? phase.dueDate)} · current {formatDate(phase.dueDate)} → revised <strong>{formatDate(proposedDue)}</strong>
                        {shift !== 0 && <> ({shift > 0 ? '+' : ''}{shift} days)</>}
                        {impactCost && parseRupees(impactCost) ? <> · fee impact {formatINR(parseRupees(impactCost))}</> : null}
                      </p>
                    )}
                    <label className="check"><input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} /> Move later phases by the same number of days</label>{' '}
                    <label className="check"><input type="checkbox" checked={moveProject} onChange={(e) => setMoveProject(e.target.checked)} /> Move the project deadline too</label>
                    <p className="hint faint" style={{ fontSize: '0.74rem' }}>The original dates are kept and the change links back to this discussion. Send the client a written confirmation of the revised dates (WhatsApp/email), and update the agreement with a new version if fees change.</p>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Field label="Tags" hint="Comma separated, e.g. disputed, timeline">{(id, d) => <input id={id} aria-describedby={d} value={tags} onChange={(e) => setTags(e.target.value)} />}</Field>
      <div className="form-actions"><button type="submit" className="btn primary" disabled={busy}>{scope ? 'Log scope change' : 'Log discussion'}</button></div>
    </form>
  );
}
