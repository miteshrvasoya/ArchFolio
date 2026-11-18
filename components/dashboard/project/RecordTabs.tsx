'use client';
/** Project tabs: discussions, requirements & references, tasks, activity. */
import { useState, type FormEvent } from 'react';
import { RequirementCategory, TaskPriority, TaskStatus, type Activity, type Discussion, type Phase, type Project, type Requirement, type Task } from '@/lib/schemas';
import { createRequirement, createTask, deleteRequirement, deleteTask, updateTask } from '@/lib/repositories';
import { formatDate, formatDateTime, label, todayIST } from '@/lib/format';
import { Card, Empty, Field, Modal, StatusChip, useAction, useUi } from '../ui';
import { PRIORITY_TONES, TASK_TONES } from '../status';
import { DiscussionEntry } from '../DiscussionEntry';
import { DiscussionForm } from '../forms/DiscussionForm';

export function DiscussionsTab({ project, phases, discussions }: { project: Project; phases: Phase[]; discussions: Discussion[] }) {
  const [mode, setMode] = useState<null | 'log' | 'scope'>(null);
  return (
    <div className="stack">
      <div className="actions">
        <button type="button" className="btn" onClick={() => setMode('log')}>+ Log discussion</button>
        <button type="button" className="btn primary" onClick={() => setMode('scope')}>+ Log scope / reference change</button>
      </div>
      {discussions.length === 0 ? <Empty title="No discussions logged">Log every call, meeting and WhatsApp decision — especially changes to scope, references and dates.</Empty> : (
        <ol className="timeline" aria-label="Discussion timeline">
          {discussions.map((d) => <li key={d.id} className={d.scopeChange ? 'scope' : d.tags.includes('disputed') ? 'disputed' : ''}><DiscussionEntry d={d} /></li>)}
        </ol>
      )}
      <Modal open={mode !== null} onClose={() => setMode(null)} title={mode === 'scope' ? 'Log a scope / reference change' : 'Log a discussion'} wide>
        {mode && <DiscussionForm projects={[project]} phases={phases} projectId={project.id} scopeChange={mode === 'scope'} onDone={() => setMode(null)} />}
      </Modal>
    </div>
  );
}

export function ReferencesTab({ project, requirements }: { project: Project; requirements: Requirement[] }) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState<Requirement['category']>('brief');
  const [links, setLinks] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayIST());
  const [err, setErr] = useState<string | null>(null);
  const { run, busy } = useAction();
  const { confirm } = useUi();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) { setErr('Describe the requirement or reference'); return; }
    const references = links.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [a, b] = l.split('|').map((x) => x.trim());
      return b ? { label: a || b, url: b } : { label: a ?? l, url: /^https?:/.test(a ?? '') ? a ?? '' : '' };
    });
    const ok = await run(() => createRequirement({ projectId: project.id, text: text.trim(), category, references, receivedOn }), 'Saved');
    if (ok) { setText(''); setLinks(''); setErr(null); }
  };
  return (
    <div className="grid side-main">
      <Card title={`Requirements & references (${requirements.length})`}>
        {requirements.length === 0 ? <p className="muted">Nothing recorded yet. Note the brief and every reference the client sends, with the date — it settles “that’s not what I asked for”.</p> : (
          <ul className="list">
            {requirements.map((r) => (
              <li key={r.id}>
                <div>
                  <div className="feed-meta"><span className="chip neutral">{label(r.category)} v{r.version}</span><span>received {formatDate(r.receivedOn)}</span></div>
                  <div style={{ fontFamily: 'var(--f-text)', fontSize: '0.98rem', whiteSpace: 'pre-wrap' }}>{r.text}</div>
                  {r.references.length > 0 && <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1rem' }}>{r.references.map((x, i) => <li key={i}>{x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer">{x.label}</a> : x.label}</li>)}</ul>}
                </div>
                <button type="button" className="btn ghost small" aria-label="Delete requirement" onClick={async () => { if (await confirm({ title: 'Delete this entry?', message: 'It will be removed from the project record.', confirmLabel: 'Delete', danger: true })) run(() => deleteRequirement(r.id)); }}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Add requirement or reference">
        <form onSubmit={submit} noValidate>
          <Field label="Category">{(id) => <select id={id} value={category} onChange={(e) => setCategory(e.target.value as Requirement['category'])}>{RequirementCategory.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select>}</Field>
          <Field label="Requirement / reference *" error={err}>{(id, d) => <textarea id={id} aria-describedby={d} rows={4} value={text} onChange={(e) => { setText(e.target.value); setErr(null); }} />}</Field>
          <Field label="Links" hint="One per line: label | https://…">{(id, d) => <textarea id={id} aria-describedby={d} rows={2} value={links} onChange={(e) => setLinks(e.target.value)} />}</Field>
          <Field label="Received on">{(id) => <input id={id} type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />}</Field>
          <div className="form-actions"><button type="submit" className="btn primary" disabled={busy}>Save</button></div>
        </form>
      </Card>
    </div>
  );
}

export function TasksTab({ project, phases, tasks }: { project: Project; phases: Phase[]; tasks: Task[] }) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState(project.teamMembers[0] ?? '');
  const [due, setDue] = useState('');
  const [phaseId, setPhaseId] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('medium');
  const [err, setErr] = useState<string | null>(null);
  const { run, busy } = useAction();
  const today = todayIST();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setErr('What needs doing?'); return; }
    const ok = await run(() => createTask({ projectId: project.id, phaseId: phaseId || null, title: title.trim(), assignee: assignee.trim(), due: due || null, status: 'todo', priority }), 'Task added');
    if (ok) { setTitle(''); setDue(''); setErr(null); }
  };
  return (
    <div className="stack">
      <Card title="Add task">
        <form onSubmit={submit} noValidate className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto', alignItems: 'end' }}>
          <Field label="Task *" error={err}>{(id, d) => <input id={id} aria-describedby={d} value={title} onChange={(e) => { setTitle(e.target.value); setErr(null); }} />}</Field>
          <Field label="Assignee">{(id) => <input id={id} value={assignee} onChange={(e) => setAssignee(e.target.value)} list="team-list" />}</Field>
          <Field label="Phase">{(id) => <select id={id} value={phaseId} onChange={(e) => setPhaseId(e.target.value)}><option value="">—</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</Field>
          <Field label="Due">{(id) => <input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
          <Field label="Priority">{(id) => <select id={id} value={priority} onChange={(e) => setPriority(e.target.value as Task['priority'])}>{TaskPriority.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select>}</Field>
          <div className="field"><button type="submit" className="btn primary" disabled={busy}>Add</button></div>
          <datalist id="team-list">{project.teamMembers.map((m) => <option key={m} value={m} />)}</datalist>
        </form>
      </Card>
      {tasks.length === 0 ? <Empty title="No tasks" /> : (
        <div className="table-wrap">
          <table className="data stack-sm">
            <thead><tr><th>Task</th><th>Assignee</th><th>Due</th><th>Priority</th><th>Status</th><th><span className="sr-only">Delete</span></th></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td data-label="Task"><span style={{ textDecoration: t.status === 'done' ? 'line-through' : undefined }}>{t.title}</span>{t.phaseId && <div className="faint" style={{ fontSize: '0.72rem' }}>{phases.find((p) => p.id === t.phaseId)?.name}</div>}</td>
                  <td data-label="Assignee">{t.assignee || '—'}</td>
                  <td data-label="Due" className={t.due && t.due < today && t.status !== 'done' ? 'total-bad' : ''}>{formatDate(t.due)}</td>
                  <td data-label="Priority"><StatusChip value={t.priority} tones={PRIORITY_TONES} /></td>
                  <td data-label="Status">
                    <label className="sr-only" htmlFor={`ts-${t.id}`}>Status of {t.title}</label>
                    <select id={`ts-${t.id}`} value={t.status} onChange={(e) => run(() => updateTask(t.id, { status: e.target.value as Task['status'] }))}>{TaskStatus.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select>
                    <span className="sr-only"><StatusChip value={t.status} tones={TASK_TONES} /></span>
                  </td>
                  <td><button type="button" className="btn ghost small" aria-label={`Delete ${t.title}`} onClick={() => run(() => deleteTask(t.id), 'Task deleted')}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ActivityTab({ activity }: { activity: Activity[] }) {
  if (!activity.length) return <Empty title="No activity yet" />;
  return (
    <Card title="Activity">
      <ol className="timeline">{activity.map((a) => <li key={a.id}><div className="feed-meta"><span className="mono">{formatDateTime(a.at)}</span><span className="chip neutral">{label(a.kind)}</span></div>{a.message}</li>)}</ol>
    </Card>
  );
}
