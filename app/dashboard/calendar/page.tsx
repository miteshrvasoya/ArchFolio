'use client';
import Link from 'next/link';
import { useState } from 'react';
import { getDiscussions, getPayments, getPhases, getProjects, getAgreements, getTasks } from '@/lib/repositories';
import { agendaItems, type DeadlineItem } from '@/lib/logic/insights';
import { addDays, formatDate, relativeDays, todayIST } from '@/lib/format';
import { useData } from '@/lib/hooks/useData';
import { Async, Chip, Empty, PageHead, type Tone } from '@/components/dashboard/ui';

const KIND: Record<DeadlineItem['kind'], { label: string; tone: Tone }> = {
  phase: { label: 'Phase', tone: 'info' }, project: { label: 'Deadline', tone: 'terra' }, payment: { label: 'Payment', tone: 'warn' },
  action: { label: 'Action', tone: 'neutral' }, task: { label: 'Task', tone: 'neutral' }
};

export default function CalendarPage() {
  const [days, setDays] = useState(30);
  const [kinds, setKinds] = useState<Set<DeadlineItem['kind']>>(new Set(['phase', 'project', 'payment', 'action', 'task']));
  const today = todayIST();
  const state = useData(async () => {
    const [projects, phases, payments, agreements, discussions, tasks] = await Promise.all([getProjects(), getPhases(), getPayments(), getAgreements(), getDiscussions(), getTasks()]);
    return { projects, phases, payments, agreements, discussions, tasks };
  });
  const toggle = (k: DeadlineItem['kind']) => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <>
      <PageHead eyebrow="Plan" title="Deadlines" actions={
        <div className="seg" role="group" aria-label="Range">{[7, 30, 90].map((n) => <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>{n} days</button>)}</div>
      } />
      <div className="filters" role="group" aria-label="Show">
        {(Object.keys(KIND) as DeadlineItem['kind'][]).map((k) => <label key={k} className="check"><input type="checkbox" checked={kinds.has(k)} onChange={() => toggle(k)} /> {KIND[k].label}s</label>)}
      </div>
      <Async state={state}>
        {(d) => {
          const overdue = agendaItems(d, '0000-01-01', addDays(today, -1), today).filter((x) => kinds.has(x.kind) && x.kind !== 'project');
          const upcoming = agendaItems(d, today, addDays(today, days), today).filter((x) => kinds.has(x.kind));
          const byDay = upcoming.reduce<Record<string, DeadlineItem[]>>((m, x) => { (m[x.date] = m[x.date] ?? []).push(x); return m; }, {});
          const Item = ({ x }: { x: DeadlineItem }) => (
            <li><div><Link className="title" href={x.href}>{x.title}</Link><small>{x.detail}</small></div><Chip tone={KIND[x.kind].tone}>{KIND[x.kind].label}</Chip></li>
          );
          return (
            <div className="grid side-main">
              <div className="card">
                {Object.keys(byDay).length === 0 ? <Empty title={`Nothing due in the next ${days} days`} /> : Object.entries(byDay).map(([date, items]) => (
                  <section key={date} className="agenda-day" aria-label={formatDate(date)}>
                    <h3 className={date === today ? 'today' : ''}>{formatDate(date)} <span className="faint">{relativeDays(date, today)}</span></h3>
                    <ul className="list">{items.map((x, i) => <Item key={i} x={x} />)}</ul>
                  </section>
                ))}
              </div>
              <div className="card">
                <h2>Overdue ({overdue.length})</h2>
                {overdue.length === 0 ? <p className="muted">Nothing overdue.</p> : <ul className="list attention">{overdue.reverse().map((x, i) => <li key={i} className="danger"><div><Link className="title" href={x.href}>{x.title}</Link><small>{formatDate(x.date)} · {x.detail}</small></div></li>)}</ul>}
              </div>
            </div>
          );
        }}
      </Async>
    </>
  );
}
