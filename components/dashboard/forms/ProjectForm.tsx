'use client';
import { useState, type FormEvent } from 'react';
import { PHASE_NAMES, ProjectSchema, ProjectStatus, ProjectType, type Client, type Project } from '@/lib/schemas';
import { createProject, updateProject, type PhaseInput, type ProjectInput } from '@/lib/repositories';
import { addDays, label, parseRupees, todayIST } from '@/lib/format';
import { Field, issuesToErrors, splitList, useAction } from '../ui';

interface PhaseRow { name: string; start: string; due: string; revisions: number; deliverables: string }

const DEFAULT_PHASES = ['Concept', '2D plans', '3D / visuals', 'Working drawings'];

export function ProjectForm({ clients, project, defaultClientId, onDone }: { clients: Client[]; project?: Project; defaultClientId?: string; onDone: (p: Project) => void }) {
  const today = todayIST();
  const [v, setV] = useState({
    clientId: project?.clientId ?? defaultClientId ?? clients[0]?.id ?? '',
    title: project?.title ?? '',
    type: project?.type ?? 'residential',
    siteLocation: project?.siteLocation ?? '',
    plotAreaSqft: project?.plotAreaSqft?.toString() ?? '',
    builtUpAreaSqft: project?.builtUpAreaSqft?.toString() ?? '',
    budgetMin: project?.budgetMin?.toString() ?? '',
    budgetMax: project?.budgetMax?.toString() ?? '',
    status: project?.status ?? 'inquiry',
    startDate: project?.startDate ?? today,
    currentDeadline: project?.currentDeadline ?? '',
    teamMembers: (project?.teamMembers ?? ['Ar. Ayush Vasoya']).join(', '),
    tags: (project?.tags ?? []).join(', ')
  });
  const [phases, setPhases] = useState<PhaseRow[]>(() => {
    let start = today;
    return DEFAULT_PHASES.map((name) => { const row = { name, start, due: addDays(start, 21), revisions: name === 'Working drawings' ? 1 : 2, deliverables: '' }; start = addDays(row.due, 1); return row; });
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  const num = (s: string) => (s.trim() ? Number(s.replace(/,/g, '')) : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input: ProjectInput = {
      clientId: v.clientId, title: v.title.trim(), type: v.type as ProjectInput['type'], siteLocation: v.siteLocation,
      plotAreaSqft: num(v.plotAreaSqft), builtUpAreaSqft: num(v.builtUpAreaSqft),
      budgetMin: v.budgetMin.trim() ? parseRupees(v.budgetMin) : null, budgetMax: v.budgetMax.trim() ? parseRupees(v.budgetMax) : null,
      status: v.status as ProjectInput['status'], startDate: v.startDate || null, currentDeadline: v.currentDeadline || null,
      teamMembers: splitList(v.teamMembers), tags: splitList(v.tags)
    };
    const errs: Record<string, string> = {};
    const check = ProjectSchema.omit({ id: true, createdAt: true, deadlineHistory: true, originalDeadline: true }).safeParse(input);
    if (!check.success) Object.assign(errs, issuesToErrors(check.error.issues));
    if (!v.clientId) errs.clientId = 'Choose a client (add one first if needed)';
    if (v.budgetMin.trim() && input.budgetMin === null) errs.budgetMin = 'Enter an amount like 75,00,000 or 75 L';
    if (v.budgetMax.trim() && input.budgetMax === null) errs.budgetMax = 'Enter an amount like 90,00,000 or 90 L';
    if (input.budgetMin !== null && input.budgetMax !== null && input.budgetMin > input.budgetMax) errs.budgetMax = 'Maximum is below the minimum';
    if (input.startDate && input.currentDeadline && input.currentDeadline < input.startDate) errs.currentDeadline = 'Deadline is before the start date';
    if (!project) phases.forEach((p, i) => { if (!p.name.trim()) errs[`phase.${i}`] = 'Phase needs a name'; else if (p.start && p.due && p.due < p.start) errs[`phase.${i}`] = 'Due date is before the start'; });
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    if (project) {
      const { currentDeadline: _ignored, ...patch } = input;
      void _ignored;
      const saved = await run(() => updateProject(project.id, patch), 'Project updated');
      if (saved) onDone(saved);
      return;
    }
    const rows: PhaseInput[] = phases.map((p) => ({
      name: p.name.trim(), description: '', deliverables: splitList(p.deliverables), startDate: p.start || null, dueDate: p.due || null,
      status: 'not-started', revisionsAllowed: p.revisions, revisionsUsed: 0, paymentMilestoneId: null
    }));
    const lastDue = rows.reduce<string | null>((m, r) => (r.dueDate && (!m || r.dueDate > m) ? r.dueDate : m), null);
    const saved = await run(() => createProject({ ...input, currentDeadline: input.currentDeadline ?? lastDue }, rows), 'Project created');
    if (saved) onDone(saved);
  };

  const updatePhase = (i: number, patch: Partial<PhaseRow>) => setPhases((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <form onSubmit={submit} noValidate>
      {Object.keys(errors).length > 0 && <div className="form-error" role="alert">Please fix the highlighted fields.</div>}
      <div className="form-grid">
        <Field label="Title *" error={errors.title} className="full">{(id, d) => <input id={id} aria-describedby={d} value={v.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Shah Residence, Vesu" autoFocus />}</Field>
        <Field label="Client *" error={errors.clientId}>{(id, d) => (
          <select id={id} aria-describedby={d} value={v.clientId} onChange={(e) => set('clientId', e.target.value)} disabled={!!project}>
            {clients.length === 0 && <option value="">No clients yet</option>}
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}</Field>
        <Field label="Type">{(id) => <select id={id} value={v.type} onChange={(e) => set('type', e.target.value)}>{ProjectType.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select>}</Field>
        <Field label="Site location" className="full">{(id) => <input id={id} value={v.siteLocation} onChange={(e) => set('siteLocation', e.target.value)} />}</Field>
        <Field label="Plot area (sq ft)">{(id) => <input id={id} inputMode="numeric" value={v.plotAreaSqft} onChange={(e) => set('plotAreaSqft', e.target.value)} />}</Field>
        <Field label="Built-up area (sq ft)">{(id) => <input id={id} inputMode="numeric" value={v.builtUpAreaSqft} onChange={(e) => set('builtUpAreaSqft', e.target.value)} />}</Field>
        <Field label="Budget from (₹)" error={errors.budgetMin} hint="e.g. 75 L or 75,00,000">{(id, d) => <input id={id} aria-describedby={d} value={v.budgetMin} onChange={(e) => set('budgetMin', e.target.value)} />}</Field>
        <Field label="Budget to (₹)" error={errors.budgetMax}>{(id, d) => <input id={id} aria-describedby={d} value={v.budgetMax} onChange={(e) => set('budgetMax', e.target.value)} />}</Field>
        <Field label="Status">{(id) => <select id={id} value={v.status} onChange={(e) => set('status', e.target.value)}>{ProjectStatus.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select>}</Field>
        <Field label="Start date">{(id) => <input id={id} type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} />}</Field>
        {!project && <Field label="Deadline" error={errors.currentDeadline} hint="Defaults to the last phase's due date">{(id, d) => <input id={id} type="date" aria-describedby={d} value={v.currentDeadline} onChange={(e) => set('currentDeadline', e.target.value)} />}</Field>}
        <Field label="Team" hint="Comma separated">{(id, d) => <input id={id} aria-describedby={d} value={v.teamMembers} onChange={(e) => set('teamMembers', e.target.value)} />}</Field>
        <Field label="Tags" hint="Comma separated">{(id, d) => <input id={id} aria-describedby={d} value={v.tags} onChange={(e) => set('tags', e.target.value)} />}</Field>
      </div>

      {!project && (
        <fieldset style={{ border: 0, padding: 0, margin: '0.5rem 0 0' }}>
          <legend className="label" style={{ marginBottom: '0.5rem' }}>Phases</legend>
          <div className="table-wrap">
            <table className="data stack-sm">
              <thead><tr><th>Phase</th><th>Start</th><th>Due</th><th className="num">Revisions</th><th>Deliverables</th><th><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {phases.map((p, i) => (
                  <tr key={i}>
                    <td data-label="Phase">
                      <input aria-label={`Phase ${i + 1} name`} list="phase-names" value={p.name} onChange={(e) => updatePhase(i, { name: e.target.value })} style={{ width: '100%' }} />
                      {errors[`phase.${i}`] && <span className="err" style={{ color: 'var(--danger)', fontSize: '0.74rem' }}>{errors[`phase.${i}`]}</span>}
                    </td>
                    <td data-label="Start"><input type="date" aria-label={`Phase ${i + 1} start`} value={p.start} onChange={(e) => updatePhase(i, { start: e.target.value })} /></td>
                    <td data-label="Due"><input type="date" aria-label={`Phase ${i + 1} due`} value={p.due} onChange={(e) => updatePhase(i, { due: e.target.value })} /></td>
                    <td data-label="Revisions" className="num"><input type="number" min={0} max={20} aria-label={`Phase ${i + 1} revisions included`} value={p.revisions} onChange={(e) => updatePhase(i, { revisions: Math.max(0, Number(e.target.value) || 0) })} style={{ width: '4rem' }} /></td>
                    <td data-label="Deliverables"><input aria-label={`Phase ${i + 1} deliverables`} placeholder="comma separated" value={p.deliverables} onChange={(e) => updatePhase(i, { deliverables: e.target.value })} style={{ width: '100%' }} /></td>
                    <td><button type="button" className="btn ghost small" aria-label={`Remove phase ${p.name || i + 1}`} onClick={() => setPhases((ps) => ps.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="phase-names">{PHASE_NAMES.map((n) => <option key={n} value={n} />)}</datalist>
          <button type="button" className="btn small" style={{ marginTop: '0.5rem' }} onClick={() => setPhases((ps) => {
            const last = ps[ps.length - 1];
            const start = last?.due ? addDays(last.due, 1) : today;
            return [...ps, { name: '', start, due: addDays(start, 14), revisions: 2, deliverables: '' }];
          })}>+ Add phase</button>
        </fieldset>
      )}
      <div className="form-actions"><button type="submit" className="btn primary" disabled={busy}>{project ? 'Save changes' : 'Create project'}</button></div>
    </form>
  );
}
