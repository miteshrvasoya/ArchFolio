'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { deleteClient, getClient, getDiscussions, getPayments, getProjectsForClient } from '@/lib/repositories';
import { totals } from '@/lib/logic/payments';
import { formatDate, label } from '@/lib/format';
import { useData } from '@/lib/hooks/useData';
import { Async, Card, Empty, Modal, Money, PageHead, StatusChip, Tags, useAction, useUi } from '@/components/dashboard/ui';
import { CLIENT_TONES, PROJECT_TONES } from '@/components/dashboard/status';
import { ClientForm } from '@/components/dashboard/forms/ClientForm';
import { DiscussionEntry } from '@/components/dashboard/DiscussionEntry';

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm } = useUi();
  const { run } = useAction();
  const [editing, setEditing] = useState(false);
  const state = useData(async () => {
    const client = await getClient(id);
    if (!client) return null;
    const projects = await getProjectsForClient(id);
    const pids = new Set(projects.map((p) => p.id));
    const [payments, discussions] = await Promise.all([getPayments(), getDiscussions()]);
    return { client, projects, money: totals(payments.filter((p) => pids.has(p.projectId))), discussions: discussions.filter((d) => pids.has(d.projectId)) };
  }, [id]);

  return (
    <Async state={state}>
      {(d) => {
        if (!d) return <Empty title="Client not found" action={<Link className="btn" href="/dashboard/clients">Back to clients</Link>} />;
        const { client, projects, money, discussions } = d;
        const title = (pid: string) => projects.find((p) => p.id === pid)?.title;
        return (
          <>
            <PageHead crumbs={[{ href: '/dashboard/clients', label: 'Clients' }]} title={client.name} actions={<>
              {client.phone && <a className="btn" href={`https://wa.me/${client.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
              <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
              <Link className="btn primary" href={`/dashboard/projects/new?client=${client.id}`}>+ Project</Link>
            </>} />
            <div className="grid side-main">
              <div className="stack">
                <Card title="Money">
                  <div className="money-row">
                    <div><div className="k">Billed</div><div className="v"><Money value={money.billed} /></div></div>
                    <div><div className="k">Received</div><div className="v"><Money value={money.received} /></div></div>
                    <div><div className="k">Outstanding</div><div className={`v${money.overdue ? ' danger' : ''}`}><Money value={money.outstanding} /></div></div>
                  </div>
                  {money.overdue > 0 && <p className="total-bad" style={{ marginBottom: 0 }}>Overdue: <Money value={money.overdue} /></p>}
                </Card>
                <Card title={`Projects (${projects.length})`}>
                  {projects.length === 0 ? <p className="muted">No projects yet.</p> : (
                    <ul className="list">
                      {projects.map((p) => (
                        <li key={p.id}><div><Link className="title" href={`/dashboard/projects/${p.id}`}>{p.title}</Link><small>{label(p.type)} · deadline {formatDate(p.currentDeadline)}</small></div><StatusChip value={p.status} tones={PROJECT_TONES} /></li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title={`Communication history (${discussions.length})`}>
                  {discussions.length === 0 ? <p className="muted">No discussions logged yet.</p> : (
                    <ol className="timeline">
                      {discussions.map((x) => <li key={x.id} className={x.scopeChange ? 'scope' : x.tags.includes('disputed') ? 'disputed' : ''}><DiscussionEntry d={x} projectTitle={title(x.projectId)} /></li>)}
                    </ol>
                  )}
                </Card>
              </div>
              <div className="stack">
                <Card title="Contact">
                  <dl className="kv">
                    <dt>Status</dt><dd><StatusChip value={client.status} tones={CLIENT_TONES} /></dd>
                    <dt>Phone</dt><dd>{client.phone ? <a href={`tel:${client.phone.replace(/\s/g, '')}`}>{client.phone}</a> : '—'}</dd>
                    <dt>Email</dt><dd>{client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : '—'}</dd>
                    <dt>Address</dt><dd>{[client.address, client.city].filter(Boolean).join(', ') || '—'}</dd>
                    <dt>Source</dt><dd>{label(client.source)}</dd>
                    <dt>Since</dt><dd>{formatDate(client.createdAt)}</dd>
                    <dt>Tags</dt><dd><Tags tags={client.tags} /></dd>
                  </dl>
                  {client.notes && <p style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--f-text)' }}>{client.notes}</p>}
                  <button type="button" className="btn danger small" onClick={async () => {
                    if (await confirm({ title: `Delete ${client.name}?`, message: 'This removes the client. Clients with projects cannot be deleted.', confirmLabel: 'Delete', danger: true })) {
                      const ok = await run(() => deleteClient(client.id).then(() => true), 'Client deleted');
                      if (ok) router.replace('/dashboard/clients');
                    }
                  }}>Delete client</button>
                </Card>
              </div>
            </div>
            <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${client.name}`}>
              <ClientForm client={client} onDone={() => setEditing(false)} />
            </Modal>
          </>
        );
      }}
    </Async>
  );
}
