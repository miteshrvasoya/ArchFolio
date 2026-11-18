'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ProjectStatus } from '@/lib/schemas';
import {
  deleteProject, getActivity, getAgreementsForProject, getClient, getClients, getDiscussions, getDocuments, getPayments,
  getPhases, getProject, getRequirements, getTasks, updateProject
} from '@/lib/repositories';
import { totals } from '@/lib/logic/payments';
import { hasAcceptedAgreement } from '@/lib/logic/insights';
import { slipDays } from '@/lib/logic/deadlines';
import { formatDate, formatINR, label } from '@/lib/format';
import { useData } from '@/lib/hooks/useData';
import { Async, Card, Chip, Empty, Loading, Modal, Money, PageHead, Tags, useAction, useUi } from '@/components/dashboard/ui';
import { PROJECT_TONES } from '@/components/dashboard/status';
import { ProjectForm } from '@/components/dashboard/forms/ProjectForm';
import { PlanTab } from '@/components/dashboard/project/PlanTab';
import { ActivityTab, DiscussionsTab, ReferencesTab, TasksTab } from '@/components/dashboard/project/RecordTabs';
import { AgreementTab, DocumentsTab, PaymentsTab } from '@/components/dashboard/project/MoneyTabs';

const TABS = [
  ['overview', 'Overview'], ['plan', 'Phases & plan'], ['discussions', 'Discussions'], ['references', 'Requirements & references'],
  ['tasks', 'Tasks'], ['agreement', 'Agreement'], ['payments', 'Payments'], ['documents', 'Documents'], ['activity', 'Activity']
] as const;
type TabKey = (typeof TABS)[number][0];

export default function ProjectPage() {
  return <Suspense fallback={<Loading />}><ProjectDetail /></Suspense>;
}

function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview') as TabKey;
  const [editing, setEditing] = useState(false);
  const { run } = useAction();
  const { confirm } = useUi();

  const state = useData(async () => {
    const project = await getProject(id);
    if (!project) return null;
    const [client, clients, phases, discussions, requirements, tasks, agreements, payments, documents, activity] = await Promise.all([
      getClient(project.clientId), getClients(), getPhases(id), getDiscussions(id), getRequirements(id), getTasks(id),
      getAgreementsForProject(id), getPayments(id), getDocuments(id), getActivity(200, id)
    ]);
    return { project, client, clients, phases, discussions, requirements, tasks, agreements, payments, documents, activity };
  }, [id]);

  const setTab = (k: TabKey) => router.replace(`/dashboard/projects/${id}${k === 'overview' ? '' : `?tab=${k}`}`, { scroll: false });

  return (
    <Async state={state}>
      {(d) => {
        if (!d) return <Empty title="Project not found" action={<Link className="btn" href="/dashboard/projects">Back to projects</Link>} />;
        const { project: p } = d;
        const money = totals(d.payments);
        const signed = hasAcceptedAgreement(p.id, d.agreements);
        const slip = slipDays(p.originalDeadline, p.currentDeadline);
        return (
          <>
            <PageHead
              crumbs={[{ href: '/dashboard/projects', label: 'Projects' }, ...(d.client ? [{ href: `/dashboard/clients/${d.client.id}`, label: d.client.name }] : [])]}
              title={p.title}
              actions={<>
                <label className="sr-only" htmlFor="pstatus">Project status</label>
                <select id="pstatus" className="btn" value={p.status} onChange={(e) => run(() => updateProject(p.id, { status: e.target.value as typeof p.status }), 'Status updated')} style={{ textTransform: 'none', letterSpacing: 0 }}>
                  {ProjectStatus.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
                </select>
                <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
              </>}
            />
            {p.status === 'in-progress' && !signed && (
              <div className="notice" role="alert">
                <strong>Work is in progress without an accepted agreement.</strong> Send one now so scope, fees and timelines are in writing.{' '}
                <Link href={`/dashboard/agreements/new?project=${p.id}`}>Create agreement →</Link>
              </div>
            )}
            <div className="tabs" role="tablist" aria-label="Project sections">
              {TABS.map(([k, text]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} aria-controls="project-panel" id={`tab-${k}`} onClick={() => setTab(k)}>
                  {text}{k === 'discussions' && d.discussions.length ? ` (${d.discussions.length})` : ''}{k === 'tasks' && d.tasks.filter((t) => t.status !== 'done').length ? ` (${d.tasks.filter((t) => t.status !== 'done').length})` : ''}
                </button>
              ))}
            </div>
            <div id="project-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
              {tab === 'overview' && (
                <div className="grid side-main">
                  <div className="stack">
                    <Card title="Money">
                      <div className="money-row">
                        <div><div className="k">Billed</div><div className="v"><Money value={money.billed} /></div></div>
                        <div><div className="k">Received</div><div className="v"><Money value={money.received} /></div></div>
                        <div><div className="k">Outstanding</div><div className={`v${money.overdue ? ' danger' : ''}`}><Money value={money.outstanding} /></div></div>
                      </div>
                      {money.overdue > 0 && <p className="total-bad" style={{ marginBottom: 0 }}>{money.overdueCount} overdue: {formatINR(money.overdue)}</p>}
                    </Card>
                    <Card title="Phases" action={<button type="button" className="link-btn" onClick={() => setTab('plan')}>Plan</button>}>
                      {d.phases.length === 0 ? <p className="muted">No phases.</p> : (
                        <ul className="list">
                          {d.phases.map((ph) => (
                            <li key={ph.id}><div><strong>{ph.name}</strong><small>due {formatDate(ph.dueDate)}{ph.originalDueDate && ph.originalDueDate !== ph.dueDate ? ` (was ${formatDate(ph.originalDueDate)})` : ''} · revisions {ph.revisionsUsed}/{ph.revisionsAllowed}</small></div><Chip tone={ph.status === 'delivered' || ph.status === 'approved' ? 'ok' : ph.status === 'revision' || ph.status === 'in-review' ? 'warn' : 'neutral'}>{label(ph.status)}</Chip></li>
                          ))}
                        </ul>
                      )}
                    </Card>
                  </div>
                  <Card title="Details">
                    <dl className="kv">
                      <dt>Status</dt><dd><Chip tone={PROJECT_TONES[p.status]}>{label(p.status)}</Chip></dd>
                      <dt>Agreement</dt><dd>{signed ? <Chip tone="ok">Accepted</Chip> : <Chip tone="warn">Not accepted</Chip>}</dd>
                      <dt>Type</dt><dd>{label(p.type)}</dd>
                      <dt>Site</dt><dd>{p.siteLocation || '—'}</dd>
                      <dt>Plot</dt><dd>{p.plotAreaSqft ? `${p.plotAreaSqft.toLocaleString('en-IN')} sq ft` : '—'}</dd>
                      <dt>Built-up</dt><dd>{p.builtUpAreaSqft ? `${p.builtUpAreaSqft.toLocaleString('en-IN')} sq ft` : '—'}</dd>
                      <dt>Budget</dt><dd>{p.budgetMin || p.budgetMax ? `${formatINR(p.budgetMin)} – ${formatINR(p.budgetMax)}` : '—'}</dd>
                      <dt>Start</dt><dd>{formatDate(p.startDate)}</dd>
                      <dt>Deadline</dt><dd>{formatDate(p.currentDeadline)} {slip !== 0 && <Chip tone="warn" title={`Original ${formatDate(p.originalDeadline)}`}>{slip > 0 ? '+' : ''}{slip} days</Chip>}</dd>
                      <dt>Team</dt><dd>{p.teamMembers.join(', ') || '—'}</dd>
                      <dt>Tags</dt><dd><Tags tags={p.tags} /></dd>
                    </dl>
                    <button type="button" className="btn danger small" style={{ marginTop: '1rem' }} onClick={async () => {
                      if (await confirm({ title: `Delete ${p.title}?`, message: 'This deletes the project with its phases, discussions, tasks, agreements, payments and documents. Export a backup first if unsure.', confirmLabel: 'Delete project', danger: true })) {
                        const ok = await run(() => deleteProject(p.id).then(() => true), 'Project deleted');
                        if (ok) router.replace('/dashboard/projects');
                      }
                    }}>Delete project</button>
                  </Card>
                </div>
              )}
              {tab === 'plan' && <PlanTab project={p} phases={d.phases} />}
              {tab === 'discussions' && <DiscussionsTab project={p} phases={d.phases} discussions={d.discussions} />}
              {tab === 'references' && <ReferencesTab project={p} requirements={d.requirements} />}
              {tab === 'tasks' && <TasksTab project={p} phases={d.phases} tasks={d.tasks} />}
              {tab === 'agreement' && <AgreementTab project={p} agreements={d.agreements} />}
              {tab === 'payments' && <PaymentsTab project={p} payments={d.payments} agreements={d.agreements} />}
              {tab === 'documents' && <DocumentsTab project={p} documents={d.documents} payments={d.payments} />}
              {tab === 'activity' && <ActivityTab activity={d.activity} />}
            </div>
            <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${p.title}`} wide>
              <ProjectForm clients={d.clients} project={p} onDone={() => setEditing(false)} />
            </Modal>
          </>
        );
      }}
    </Async>
  );
}
