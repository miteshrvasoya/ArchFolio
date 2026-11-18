'use client';
import Link from 'next/link';
import { getActivity, getAgreements, getDiscussions, getPayments, getPhases, getProjects } from '@/lib/repositories';
import { attentionItems, overviewKpis, upcomingDeadlines } from '@/lib/logic/insights';
import { addDays, formatDate, formatDateTime, formatINR, relativeDays, todayIST } from '@/lib/format';
import { useData } from '@/lib/hooks/useData';
import { Async, Card, Empty, PageHead } from '@/components/dashboard/ui';

export default function OverviewPage() {
  const state = useData(async () => {
    const [projects, phases, payments, agreements, discussions, activity] = await Promise.all([
      getProjects(), getPhases(), getPayments(), getAgreements(), getDiscussions(), getActivity(12)
    ]);
    return { projects, phases, payments, agreements, discussions, activity };
  });
  const today = todayIST();

  return (
    <>
      <PageHead eyebrow={formatDate(today)} title="Overview" />
      <Async state={state}>
        {(d) => {
          const k = overviewKpis(d, today);
          const attention = attentionItems(d, today);
          const deadlines = upcomingDeadlines(d, today, addDays(today, 7));
          return (
            <>
              <div className="kpis">
                <Link className="kpi" href="/dashboard/projects?status=in-progress"><span className="k">Active projects</span><span className="v">{k.activeProjects}</span><span className="s">in progress</span></Link>
                <Link className={`kpi${k.awaitingAcceptance ? ' warn' : ''}`} href="/dashboard/agreements?status=awaiting"><span className="k">Awaiting acceptance</span><span className="v">{k.awaitingAcceptance}</span><span className="s">agreements sent</span></Link>
                <Link className="kpi" href="/dashboard/payments?status=outstanding"><span className="k">Outstanding</span><span className="v">{formatINR(k.outstanding)}</span><span className="s">to be received</span></Link>
                <Link className={`kpi${k.overdueCount ? ' danger' : ''}`} href="/dashboard/payments?status=overdue"><span className="k">Overdue</span><span className="v">{formatINR(k.overdueAmount)}</span><span className="s">{k.overdueCount} payment{k.overdueCount === 1 ? '' : 's'}</span></Link>
                <Link className={`kpi${k.deadlinesNext7 ? ' warn' : ''}`} href="/dashboard/calendar"><span className="k">Next 7 days</span><span className="v">{k.deadlinesNext7}</span><span className="s">deadlines</span></Link>
              </div>

              <div className="grid side-main">
                <div className="stack">
                  <Card title={`Needs attention (${attention.length})`}>
                    {attention.length === 0 ? <Empty title="Nothing needs attention">Payments, agreements and deadlines are all on track.</Empty> : (
                      <ul className="list attention">
                        {attention.slice(0, 12).map((a, i) => (
                          <li key={`${a.kind}-${i}`} className={a.severity}>
                            <div><Link className="title" href={a.href}>{a.title}</Link><small>{a.detail}</small></div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                  <Card title="Due in the next 7 days" action={<Link href="/dashboard/calendar">All deadlines</Link>}>
                    {deadlines.length === 0 ? <p className="muted">No deadlines this week.</p> : (
                      <ul className="list">
                        {deadlines.map((x, i) => (
                          <li key={i}><div><Link className="title" href={x.href}>{x.title}</Link><small>{x.detail}</small></div><span className="nowrap">{formatDate(x.date)} <small>{relativeDays(x.date, today)}</small></span></li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>
                <div className="stack">
                  <Card title="Quick actions">
                    <div className="quick">
                      <Link className="btn" href="/dashboard/clients?new=1">+ New client</Link>
                      <Link className="btn" href="/dashboard/projects/new">+ New project</Link>
                      <Link className="btn" href="/dashboard/agreements/new">+ New agreement</Link>
                      <Link className="btn" href="/dashboard/discussions?new=1">+ Log discussion</Link>
                      <Link className="btn primary" href="/dashboard/payments?record=1">+ Record payment</Link>
                    </div>
                  </Card>
                  <Card title="Recent activity">
                    {d.activity.length === 0 ? <p className="muted">No activity yet.</p> : (
                      <ul className="list">
                        {d.activity.map((a) => (
                          <li key={a.id}><div>{a.projectId ? <Link className="title" style={{ fontWeight: 500 }} href={`/dashboard/projects/${a.projectId}`}>{a.message}</Link> : a.message}<small>{formatDateTime(a.at)}</small></div></li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>
              </div>
            </>
          );
        }}
      </Async>
    </>
  );
}
