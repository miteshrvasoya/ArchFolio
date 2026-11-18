'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { AgreementVersionStatus } from '@/lib/schemas';
import { current, getAgreements, getClients, getProjects, latest } from '@/lib/repositories';
import { formatDate, formatINR, label } from '@/lib/format';
import { useData } from '@/lib/hooks/useData';
import { Async, Empty, Loading, PageHead, StatusChip } from '@/components/dashboard/ui';
import { AGREEMENT_TONES } from '@/components/dashboard/status';
import { DISCLAIMER } from '@/components/agreement/AgreementDocument';

export default function AgreementsPage() {
  return <Suspense fallback={<Loading />}><Agreements /></Suspense>;
}

function Agreements() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [project, setProject] = useState('');
  const [q, setQ] = useState('');
  const state = useData(async () => {
    const [agreements, projects, clients] = await Promise.all([getAgreements(), getProjects(), getClients()]);
    return { agreements, projects, clients };
  });
  const rows = useMemo(() => (state.data?.agreements ?? []).map((a) => {
    const p = state.data?.projects.find((x) => x.id === a.projectId);
    return { a, l: latest(a), cur: current(a), project: p, client: state.data?.clients.find((c) => c.id === p?.clientId) };
  }).filter((r) => {
    const s = q.trim().toLowerCase();
    const st = status === 'awaiting' ? ['sent', 'viewed'].includes(r.l.status) : !status || r.l.status === status;
    return st && (!project || r.a.projectId === project) && (!s || [r.a.title, r.project?.title ?? '', r.client?.name ?? ''].some((f) => f.toLowerCase().includes(s)));
  }), [state.data, status, project, q]);

  return (
    <>
      <PageHead eyebrow="Practice" title="Agreements" actions={<Link className="btn primary" href="/dashboard/agreements/new">+ New agreement</Link>} />
      <div className="filters" role="group" aria-label="Filter agreements">
        <div className="field"><label htmlFor="aq">Search</label><input id="aq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, project, client…" /></div>
        <div className="field"><label htmlFor="as">Status (latest version)</label><select id="as" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="awaiting">Awaiting acceptance</option>{AgreementVersionStatus.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></div>
        <div className="field"><label htmlFor="ap">Project</label><select id="ap" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All</option>{(state.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
      </div>
      <Async state={state}>
        {(d) => d.agreements.length === 0 ? (
          <Empty title="No agreements yet" action={<Link className="btn primary" href="/dashboard/agreements/new">Create from a template</Link>}>Send the agreement before drawing starts — scope, fees, revisions and timelines in writing.</Empty>
        ) : rows.length === 0 ? <Empty title="No agreements match these filters" /> : (
          <div className="table-wrap">
            <table className="data stack-sm">
              <thead><tr><th>Agreement</th><th>Client</th><th>Latest version</th><th>Governing</th><th className="num">Fee</th><th>Updated</th></tr></thead>
              <tbody>
                {rows.map(({ a, l, cur, project: p, client }) => (
                  <tr key={a.id}>
                    <td data-label="Agreement"><Link href={`/dashboard/agreements/${a.id}`}>{a.title}</Link><div className="faint" style={{ fontSize: '0.74rem' }}>{p?.title}</div></td>
                    <td data-label="Client">{client?.name ?? '—'}</td>
                    <td data-label="Latest"><StatusChip value={l.status} tones={AGREEMENT_TONES} /> <span className="mono">v{l.version}</span></td>
                    <td data-label="Governing">{cur.status === 'accepted' ? <>v{cur.version} accepted by {cur.acceptedByName}<div className="faint" style={{ fontSize: '0.72rem' }}>{formatDate(cur.acceptedAt)}</div></> : <span className="faint">none accepted</span>}</td>
                    <td data-label="Fee" className="num">{formatINR(l.content.fees.totalFee)}</td>
                    <td data-label="Updated">{formatDate(l.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      <p className="disclaimer">{DISCLAIMER}</p>
    </>
  );
}
