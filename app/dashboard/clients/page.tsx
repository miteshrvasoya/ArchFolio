'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { ClientSource, ClientStatus } from '@/lib/schemas';
import { getClients, getPayments, getProjects } from '@/lib/repositories';
import { totals } from '@/lib/logic/payments';
import { label } from '@/lib/format';
import { useData } from '@/lib/hooks/useData';
import { Async, Empty, Loading, Modal, Money, PageHead, StatusChip, Tags, useSort } from '@/components/dashboard/ui';
import { CLIENT_TONES } from '@/components/dashboard/status';
import { ClientForm } from '@/components/dashboard/forms/ClientForm';

export default function ClientsPage() {
  return <Suspense fallback={<Loading />}><Clients /></Suspense>;
}

function Clients() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [source, setSource] = useState('');
  const [tag, setTag] = useState('');
  const creating = params.get('new') === '1';
  const state = useData(async () => {
    const [clients, projects, payments] = await Promise.all([getClients(), getProjects(), getPayments()]);
    return clients.map((c) => {
      const pids = new Set(projects.filter((p) => p.clientId === c.id).map((p) => p.id));
      return { ...c, projectCount: pids.size, money: totals(payments.filter((p) => pids.has(p.projectId))) };
    });
  });
  type Row = NonNullable<typeof state.data>[number];
  const allTags = useMemo(() => [...new Set((state.data ?? []).flatMap((c) => c.tags))].sort(), [state.data]);
  const filtered = useMemo(() => (state.data ?? []).filter((c) => {
    const s = q.trim().toLowerCase();
    return (!s || [c.name, c.phone, c.email, c.city, c.notes].some((f) => f.toLowerCase().includes(s)))
      && (!status || c.status === status) && (!source || c.source === source) && (!tag || c.tags.includes(tag));
  }), [state.data, q, status, source, tag]);
  const accessors = useMemo(() => ({
    name: (c: Row) => c.name.toLowerCase(), status: (c: Row) => c.status, projects: (c: Row) => c.projectCount,
    outstanding: (c: Row) => c.money.outstanding, created: (c: Row) => c.createdAt
  }), []);
  const { sorted, header, ariaSort } = useSort(filtered, { key: 'name', dir: 'asc' }, accessors);

  return (
    <>
      <PageHead eyebrow="Practice" title="Clients" actions={<Link className="btn primary" href="/dashboard/clients?new=1">+ New client</Link>} />
      <div className="filters" role="group" aria-label="Filter clients">
        <div className="field"><label htmlFor="cq">Search</label><input id="cq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, city…" /></div>
        <div className="field"><label htmlFor="cs">Status</label><select id="cs" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{ClientStatus.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></div>
        <div className="field"><label htmlFor="csrc">Source</label><select id="csrc" value={source} onChange={(e) => setSource(e.target.value)}><option value="">All</option>{ClientSource.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></div>
        <div className="field"><label htmlFor="ct">Tag</label><select id="ct" value={tag} onChange={(e) => setTag(e.target.value)}><option value="">All</option>{allTags.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
      </div>
      <Async state={state}>
        {(all) => all.length === 0 ? (
          <Empty title="No clients yet" action={<Link className="btn primary" href="/dashboard/clients?new=1">Add your first client</Link>}>Add clients as soon as an inquiry comes in, so every conversation has a home.</Empty>
        ) : sorted.length === 0 ? <Empty title="No clients match these filters" /> : (
          <div className="table-wrap">
            <table className="data stack-sm">
              <caption className="sr-only">Clients</caption>
              <thead><tr>
                <th aria-sort={ariaSort('name')}>{header('name', 'Name')}</th>
                <th>Contact</th>
                <th aria-sort={ariaSort('status')}>{header('status', 'Status')}</th>
                <th>Source</th>
                <th className="num" aria-sort={ariaSort('projects')}>{header('projects', 'Projects')}</th>
                <th className="num" aria-sort={ariaSort('outstanding')}>{header('outstanding', 'Outstanding')}</th>
                <th>Tags</th>
              </tr></thead>
              <tbody>
                {sorted.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Name"><Link href={`/dashboard/clients/${c.id}`}>{c.name}</Link><div className="faint" style={{ fontSize: '0.74rem' }}>{c.city}</div></td>
                    <td data-label="Contact">{c.phone && <a href={`tel:${c.phone.replace(/\s/g, '')}`} style={{ fontWeight: 400 }}>{c.phone}</a>}{c.email && <div className="faint" style={{ fontSize: '0.74rem' }}>{c.email}</div>}</td>
                    <td data-label="Status"><StatusChip value={c.status} tones={CLIENT_TONES} /></td>
                    <td data-label="Source">{label(c.source)}</td>
                    <td data-label="Projects" className="num">{c.projectCount}</td>
                    <td data-label="Outstanding" className="num"><Money value={c.money.outstanding} className={c.money.overdue ? 'total-bad' : ''} /></td>
                    <td data-label="Tags"><Tags tags={c.tags} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      <Modal open={creating} onClose={() => router.replace('/dashboard/clients')} title="New client">
        <ClientForm onDone={(c) => router.replace(`/dashboard/clients/${c.id}`)} />
      </Modal>
    </>
  );
}
