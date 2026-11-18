'use client';
import { useState, type FormEvent } from 'react';
import { PHASE_NAMES, PhaseStatus, type Phase, type Project } from '@/lib/schemas';
import { changePhaseDeadline, changeProjectDeadline, createPhase, deletePhase, updatePhase } from '@/lib/repositories';
import { addDays, daysBetween, formatDate, label, splitListSafe, todayIST } from './helpers';
import { slipDays } from '@/lib/logic/deadlines';
import { Card, Chip, Empty, Field, Modal, useAction, useUi } from '../ui';

/** Phases and plan: Gantt-style timeline, status and revisions, deadline changes with history. */
export function PlanTab({ project, phases }: { project: Project; phases: Phase[] }) {
  const [moving, setMoving] = useState<Phase | null>(null);
  const [movingProject, setMovingProject] = useState(false);
  const [adding, setAdding] = useState(false);
  const { run } = useAction();
  const { confirm } = useUi();
  const today = todayIST();

  const dates = [project.startDate, project.currentDeadline, ...phases.flatMap((p) => [p.startDate, p.dueDate, p.originalDueDate])].filter((d): d is string => !!d).sort();
  const min = dates[0] ?? today, max = dates[dates.length - 1] ?? addDays(today, 30);
  const span = Math.max(1, daysBetween(min, max));
  const pos = (d: string) => `${Math.min(100, Math.max(0, (daysBetween(min, d) / span) * 100))}%`;

  return (
    <div className="stack">
      <Card title="Timeline" action={<span className="faint" style={{ fontSize: '0.7rem', letterSpacing: 0, textTransform: 'none' }}>dashed line = original due date</span>}>
        {phases.length === 0 ? <Empty title="No phases yet" action={<button type="button" className="btn primary" onClick={() => setAdding(true)}>Add a phase</button>} /> : (
          <>
            <div className="gantt" role="list" aria-label="Phase timeline">
              {phases.map((p) => {
                const start = p.startDate ?? p.dueDate ?? min;
                const end = p.dueDate ?? start;
                const late = p.dueDate && p.dueDate < today && !['approved', 'delivered'].includes(p.status);
                return (
                  <div key={p.id} className="gantt-row" role="listitem">
                    <div style={{ fontSize: '0.8rem' }}><strong>{p.name}</strong><div className="faint" style={{ fontSize: '0.7rem' }}>{formatDate(p.startDate)} → {formatDate(p.dueDate)}</div></div>
                    <div className="gantt-track" aria-label={`${p.name}: ${formatDate(p.startDate)} to ${formatDate(p.dueDate)}, ${label(p.status)}${late ? ', late' : ''}`}>
                      <div className={`gantt-bar ${late ? 'late' : p.status}`} style={{ left: pos(start), width: `calc(${pos(end)} - ${pos(start)} + 4px)` }} />
                      {p.originalDueDate && p.originalDueDate !== p.dueDate && <div className="gantt-orig" style={{ left: pos(p.originalDueDate) }} title={`Original due ${formatDate(p.originalDueDate)}`} />}
                      {today >= min && today <= max && <div className="gantt-today" style={{ left: pos(today) }} title="Today" />}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="gantt-scale" aria-hidden="true"><span>{formatDate(min)}</span><span>{formatDate(max)}</span></div>
          </>
        )}
      </Card>

      <Card title="Phases" action={<button type="button" className="btn small" onClick={() => setAdding(true)}>+ Phase</button>}>
        {phases.length > 0 && (
          <div className="table-wrap">
            <table className="data stack-sm">
              <thead><tr><th>Phase</th><th>Status</th><th>Due</th><th className="num">Revisions</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {phases.map((p) => {
                  const slip = slipDays(p.originalDueDate, p.dueDate);
                  return (
                    <tr key={p.id}>
                      <td data-label="Phase"><strong>{p.name}</strong>{p.deliverables.length > 0 && <div className="faint" style={{ fontSize: '0.74rem' }}>{p.deliverables.join(' · ')}</div>}</td>
                      <td data-label="Status">
                        <label className="sr-only" htmlFor={`st-${p.id}`}>Status of {p.name}</label>
                        <select id={`st-${p.id}`} value={p.status} onChange={(e) => run(() => updatePhase(p.id, { status: e.target.value as Phase['status'] }), 'Phase updated')}>
                          {PhaseStatus.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
                        </select>
                      </td>
                      <td data-label="Due">
                        {formatDate(p.dueDate)} {slip !== 0 && <Chip tone={slip > 0 ? 'warn' : 'ok'} title={`Original ${formatDate(p.originalDueDate)}`}>{slip > 0 ? '+' : ''}{slip}d</Chip>}
                        {p.dueDateHistory.length > 0 && (
                          <details><summary className="faint" style={{ fontSize: '0.72rem', cursor: 'pointer' }}>{p.dueDateHistory.length} change{p.dueDateHistory.length > 1 ? 's' : ''}</summary>
                            <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1rem', fontSize: '0.76rem' }}>
                              {p.dueDateHistory.map((h, i) => <li key={i}>{formatDate(h.from)} → {formatDate(h.to)} <span className="faint">({formatDate(h.changedAt)})</span><br />{h.reason}</li>)}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td data-label="Revisions" className="num">
                        <span className={p.revisionsUsed > p.revisionsAllowed ? 'total-bad' : ''}>{p.revisionsUsed} / {p.revisionsAllowed}</span>{' '}
                        <button type="button" className="btn ghost small" aria-label={`Record a revision on ${p.name}`} onClick={() => run(() => updatePhase(p.id, { revisionsUsed: p.revisionsUsed + 1 }), p.revisionsUsed + 1 > p.revisionsAllowed ? 'Revision recorded — beyond the included revisions (chargeable)' : 'Revision recorded')}>+1</button>
                      </td>
                      <td>
                        <div className="actions">
                          <button type="button" className="btn small" onClick={() => setMoving(p)}>Change date</button>
                          <button type="button" className="btn ghost small" aria-label={`Delete ${p.name}`} onClick={async () => { if (await confirm({ title: `Delete ${p.name}?`, message: 'The phase and its deadline history are removed. Tasks stay on the project.', confirmLabel: 'Delete', danger: true })) run(() => deletePhase(p.id), 'Phase deleted'); }}>✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Project deadline" action={<button type="button" className="btn small" onClick={() => setMovingProject(true)}>Change deadline</button>}>
        <dl className="kv">
          <dt>Current</dt><dd>{formatDate(project.currentDeadline)}</dd>
          <dt>Original</dt><dd>{formatDate(project.originalDeadline)} {slipDays(project.originalDeadline, project.currentDeadline) !== 0 && <Chip tone="warn">{slipDays(project.originalDeadline, project.currentDeadline) > 0 ? '+' : ''}{slipDays(project.originalDeadline, project.currentDeadline)} days</Chip>}</dd>
        </dl>
        {project.deadlineHistory.length > 0 && (
          <ol className="timeline" style={{ marginTop: '0.75rem' }}>
            {project.deadlineHistory.map((h, i) => <li key={i}><div className="feed-meta"><span>{formatDate(h.changedAt)}</span></div>{formatDate(h.from)} → <strong>{formatDate(h.to)}</strong> — {h.reason}</li>)}
          </ol>
        )}
      </Card>

      <Modal open={!!moving} onClose={() => setMoving(null)} title={`Change due date — ${moving?.name ?? ''}`}>
        {moving && <DeadlineForm current={moving.dueDate} original={moving.originalDueDate} withCascade onSubmit={async (to, reason, cascade, moveProject) => {
          const ok = await run(() => changePhaseDeadline({ phaseId: moving.id, to, reason, cascade, moveProject }), 'Due date changed');
          if (ok !== undefined) setMoving(null);
        }} />}
      </Modal>
      <Modal open={movingProject} onClose={() => setMovingProject(false)} title="Change project deadline">
        <DeadlineForm current={project.currentDeadline} original={project.originalDeadline} onSubmit={async (to, reason) => {
          const ok = await run(() => changeProjectDeadline(project.id, to, reason), 'Deadline changed');
          if (ok) setMovingProject(false);
        }} />
      </Modal>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add phase">
        <PhaseForm onSubmit={async (input) => { const ok = await run(() => createPhase(project.id, input), 'Phase added'); if (ok) setAdding(false); }} />
      </Modal>
    </div>
  );
}

function DeadlineForm({ current, original, withCascade = false, onSubmit }: { current: string | null; original: string | null; withCascade?: boolean; onSubmit: (to: string, reason: string, cascade: boolean, moveProject: boolean) => void }) {
  const [to, setTo] = useState(current ?? todayIST());
  const [reason, setReason] = useState('');
  const [cascade, setCascade] = useState(true);
  const [moveProject, setMoveProject] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shift = current ? daysBetween(current, to) : 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) { setErr('Write down why the date changes — this is your record if it is disputed later.'); return; }
    onSubmit(to, reason.trim(), cascade, moveProject);
  };
  return (
    <form onSubmit={submit} noValidate>
      <p className="impact">Original {formatDate(original ?? current)} · current {formatDate(current)} → new <strong>{formatDate(to)}</strong>{shift !== 0 && <> ({shift > 0 ? '+' : ''}{shift} days)</>}</p>
      <Field label="New date">{(id) => <input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
      <Field label="Reason *" error={err} hint="e.g. client feedback received 10 days late">{(id, d) => <textarea id={id} aria-describedby={d} rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setErr(null); }} />}</Field>
      {withCascade && (
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          <label className="check"><input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} /> Move later phases by the same number of days</label>
          <label className="check"><input type="checkbox" checked={moveProject} onChange={(e) => setMoveProject(e.target.checked)} /> Move the project deadline too</label>
        </div>
      )}
      <div className="form-actions"><button type="submit" className="btn primary">Save new date</button></div>
    </form>
  );
}

function PhaseForm({ onSubmit }: { onSubmit: (input: Parameters<typeof createPhase>[1]) => void }) {
  const [name, setName] = useState('');
  const [start, setStart] = useState(todayIST());
  const [due, setDue] = useState(addDays(todayIST(), 14));
  const [revisions, setRevisions] = useState(2);
  const [deliverables, setDeliverables] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <form noValidate onSubmit={(e) => {
      e.preventDefault();
      if (!name.trim()) { setErr('Name the phase'); return; }
      if (due < start) { setErr('Due date is before the start'); return; }
      onSubmit({ name: name.trim(), description: '', deliverables: splitListSafe(deliverables), startDate: start, dueDate: due, status: 'not-started', revisionsAllowed: revisions, revisionsUsed: 0, paymentMilestoneId: null });
    }}>
      {err && <div className="form-error" role="alert">{err}</div>}
      <Field label="Name *">{(id) => <input id={id} list="phase-names-2" value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
      <datalist id="phase-names-2">{PHASE_NAMES.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="form-grid">
        <Field label="Start">{(id) => <input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label="Due">{(id) => <input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
        <Field label="Revisions included">{(id) => <input id={id} type="number" min={0} value={revisions} onChange={(e) => setRevisions(Math.max(0, Number(e.target.value) || 0))} />}</Field>
        <Field label="Deliverables" hint="Comma separated">{(id, d) => <input id={id} aria-describedby={d} value={deliverables} onChange={(e) => setDeliverables(e.target.value)} />}</Field>
      </div>
      <div className="form-actions"><button type="submit" className="btn primary">Add phase</button></div>
    </form>
  );
}
