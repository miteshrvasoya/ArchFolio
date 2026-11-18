'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { ProjectStatus, ProjectType } from '@/lib/schemas';
import { getAgreements, getClients, getPayments, getProjects } from '@/lib/repositories';
import { totals } from '@/lib/logic/payments';
import { hasAcceptedAgreement } from '@/lib/logic/insights';
import { formatDate, label, relativeDays, todayIST } from '@/lib/format';
import { useData } from '@/lib/hooks/useData';
import { Async, Chip, Empty, Loading, Money, PageHead, StatusChip, useSort } from '@/components/dashboard/ui';
import { PROJECT_TONES } from '@/components/dashboard/status';

export default function ProjectsPage() {
  return <Suspense fallback={<Loading />}><Projects /></Suspense>;
}

function Projects() {
  const params = useSearchParams();
  const [view, setView] = useState<'list' | 'board'>('list');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [type, setType] = useState('');
  const [client, setClient] = useState(params.get('client') ?? '');
  const today = todayIST();
  const state = useData(async () => {
    const [projects, clients, payments, agreements] = await Promise.all([getProjects(), getClients(), getPayments(), getAgreements()]);
    return {
      clients,
      rows: projects.map((p) => ({
        ...p,
        clientName: clients.find((c) => c.id === p.clientId)?.name ?? '—',
        money: totals(payments.filter((x) => x.projectId === p.id)),
        signed: hasAcceptedAgreement(p.id, agreements)
      }))
    };
  });
  type Row = NonNullable<typeof state.data>['rows'][number];
  const filtered = useMemo(() => (state.data?.rows ?? []).filter((p) => {
    const s = q.trim().toLowerCase();
    return (!s || [p.title, p.siteLocation, p.clientName, ...p.tags].some((f) => f.toLowerCase().includes(s)))
      && (!status || p.status === status) && (!type || p.type === type) && (!client || p.clientId === client);
  }), [state.data, q, status, type, client]);
  const accessors = useMemo(() => ({
    title: (p: Row) => p.title.toLowerCase(), client: (p: Row) => p.clientName.toLowerCase(), status: (p: Row) => ProjectStatus.options.indexOf(p.status),
    deadline: (p: Row) => p.currentDeadline ?? '9999', outstanding: (p: Row) => p.money.outstanding
  }), []);
  const { sorted, header, ariaSort } = useSort(filtered, { key: 'deadline', dir: 'asc' }, accessors);

  return (
    <>
      <PageHead eyebrow="Practice" title="Projects" actions={<>
        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
          <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</button>
        </div>
        <Link className="btn primary" href="/dashboard/projects/new">+ New project</Link>
      </>} />
      <div className="filters" role="group" aria-label="Filter projects">
        <div className="field"><label htmlFor="pq">Search</label><input id="pq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, site, client…" /></div>
        <div className="field"><label htmlFor="ps">Status</label><select id="ps" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{ProjectStatus.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></div>
        <div className="field"><label htmlFor="pt">Type</label><select id="pt" value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{ProjectType.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></div>
        <div className="field"><label htmlFor="pc">Client</label><select id="pc" value={client} onChange={(e) => setClient(e.target.value)}><option value="">All</option>{(state.data?.clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div>
      <Async state={state}>
        {(d) => d.rows.length === 0 ? (
          <Empty title="No projects yet" action={<Link className="btn primary" href="/dashboard/projects/new">Create a project</Link>}>Create the project at inquiry stage — before any drawing — so the agreement comes first.</Empty>
        ) : sorted.length === 0 ? <Empty title="No projects match these filters" /> : view === 'board' ? (
          <div className="kanban" aria-label="Projects by status">
            {ProjectStatus.options.map((s) => {
              const col = sorted.filter((p) => p.status === s);
              return (
                <section key={s} className="kanban-col" aria-label={label(s)}>
                  <h3><span>{label(s)}</span><span className="mono">{col.length}</span></h3>
                  {col.map((p) => (
                    <Link key={p.id} className="kcard" href={`/dashboard/projects/${p.id}`}>
                      <strong>{p.title}</strong>
                      <small>{p.clientName}</small>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                        {p.currentDeadline && <Chip tone={p.currentDeadline < today && !['delivered', 'closed', 'cancelled'].includes(p.status) ? 'danger' : 'neutral'}>{formatDate(p.currentDeadline)}</Chip>}
                        {p.status === 'in-progress' && !p.signed && <Chip tone="danger">No agreement</Chip>}
                        {p.money.overdue > 0 && <Chip tone="danger">Overdue</Chip>}
                      </div>
                    </Link>
                  ))}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data stack-sm">
              <caption className="sr-only">Projects</caption>
              <thead><tr>
                <th aria-sort={ariaSort('title')}>{header('title', 'Project')}</th>
                <th aria-sort={ariaSort('client')}>{header('client', 'Client')}</th>
                <th aria-sort={ariaSort('status')}>{header('status', 'Status')}</th>
                <th aria-sort={ariaSort('deadline')}>{header('deadline', 'Deadline')}</th>
                <th className="num" aria-sort={ariaSort('outstanding')}>{header('outstanding', 'Outstanding')}</th>
              </tr></thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Project"><Link href={`/dashboard/projects/${p.id}`}>{p.title}</Link><div className="faint" style={{ fontSize: '0.74rem' }}>{label(p.type)} · {p.siteLocation}</div></td>
                    <td data-label="Client"><Link href={`/dashboard/clients/${p.clientId}`} style={{ fontWeight: 400 }}>{p.clientName}</Link></td>
                    <td data-label="Status"><StatusChip value={p.status} tones={PROJECT_TONES} /> {p.status === 'in-progress' && !p.signed && <Chip tone="danger">No agreement</Chip>}</td>
                    <td data-label="Deadline">{formatDate(p.currentDeadline)}{p.originalDeadline && p.currentDeadline && p.originalDeadline !== p.currentDeadline && <div className="faint" style={{ fontSize: '0.72rem' }}>was {formatDate(p.originalDeadline)}</div>}{p.currentDeadline && <div className="faint" style={{ fontSize: '0.72rem' }}>{relativeDays(p.currentDeadline, today)}</div>}</td>
                    <td data-label="Outstanding" className="num"><Money value={p.money.outstanding} className={p.money.overdue ? 'total-bad' : ''} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
    </>
  );
}
