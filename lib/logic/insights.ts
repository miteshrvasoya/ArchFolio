/**
 * Overview maths — what needs attention, computed from plain data (pure, so it
 * can move to a backend unchanged).
 */
import type { Agreement, Discussion, Payment, Phase, Project } from '@/lib/schemas';
import { addDays, daysBetween } from '@/lib/format';
import { summarisePayment, totals } from './payments';

export interface AttentionItem {
  kind: 'overdue-payment' | 'no-agreement' | 'deadline-passed' | 'action-item' | 'revisions-exceeded';
  severity: 'danger' | 'warn';
  title: string;
  detail: string;
  href: string;
  /** for sorting: the date that makes it urgent */
  date: string;
}

const latestVersion = (a: Agreement) => a.versions.reduce((m, v) => (v.version > m.version ? v : m));
const DONE_PHASE = new Set(['approved', 'delivered']);
const LIVE_PROJECT = new Set(['in-progress', 'on-hold', 'agreement-pending']);

export function hasAcceptedAgreement(projectId: string, agreements: Agreement[]): boolean {
  return agreements.some((a) => a.projectId === projectId && a.versions.some((v) => v.status === 'accepted'));
}

export interface OverviewInput {
  projects: Project[];
  phases: Phase[];
  payments: Payment[];
  agreements: Agreement[];
  discussions: Discussion[];
}

export function overviewKpis(d: OverviewInput, today: string) {
  const t = totals(d.payments, today);
  const in7 = addDays(today, 7);
  const deadlines = upcomingDeadlines(d, today, in7);
  return {
    activeProjects: d.projects.filter((p) => p.status === 'in-progress').length,
    awaitingAcceptance: d.agreements.filter((a) => ['sent', 'viewed'].includes(latestVersion(a).status)).length,
    outstanding: t.outstanding,
    overdueAmount: t.overdue,
    overdueCount: t.overdueCount,
    deadlinesNext7: deadlines.length
  };
}

export interface DeadlineItem { date: string; title: string; detail: string; href: string; kind: 'phase' | 'project' | 'payment' | 'action' }

export function upcomingDeadlines(d: OverviewInput, from: string, to: string): DeadlineItem[] {
  const title = (id: string) => d.projects.find((p) => p.id === id)?.title ?? 'Project';
  const out: DeadlineItem[] = [];
  for (const ph of d.phases) {
    if (ph.dueDate && !DONE_PHASE.has(ph.status) && ph.dueDate >= from && ph.dueDate <= to) {
      out.push({ date: ph.dueDate, title: `${ph.name} due`, detail: title(ph.projectId), href: `/dashboard/projects/${ph.projectId}?tab=plan`, kind: 'phase' });
    }
  }
  for (const p of d.projects) {
    if (p.currentDeadline && LIVE_PROJECT.has(p.status) && p.currentDeadline >= from && p.currentDeadline <= to) {
      out.push({ date: p.currentDeadline, title: 'Project deadline', detail: p.title, href: `/dashboard/projects/${p.id}`, kind: 'project' });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function attentionItems(d: OverviewInput, today: string): AttentionItem[] {
  const title = (id: string) => d.projects.find((p) => p.id === id)?.title ?? 'Project';
  const items: AttentionItem[] = [];
  for (const p of d.payments) {
    const s = summarisePayment(p, today);
    if (s.overdue && p.dueDate) items.push({ kind: 'overdue-payment', severity: 'danger', title: `${p.label} overdue by ${s.daysOverdue} days`, detail: `${title(p.projectId)} · ₹${s.outstanding.toLocaleString('en-IN')} outstanding`, href: `/dashboard/payments?project=${p.projectId}`, date: p.dueDate });
  }
  for (const p of d.projects) {
    if (p.status === 'in-progress' && !hasAcceptedAgreement(p.id, d.agreements)) {
      items.push({ kind: 'no-agreement', severity: 'danger', title: 'Work in progress without an accepted agreement', detail: p.title, href: `/dashboard/projects/${p.id}?tab=agreement`, date: p.startDate ?? today });
    }
  }
  for (const ph of d.phases) {
    if (ph.dueDate && ph.dueDate < today && !DONE_PHASE.has(ph.status)) {
      items.push({ kind: 'deadline-passed', severity: 'warn', title: `${ph.name} is ${daysBetween(ph.dueDate, today)} days past due`, detail: title(ph.projectId), href: `/dashboard/projects/${ph.projectId}?tab=plan`, date: ph.dueDate });
    }
    if (ph.revisionsUsed > ph.revisionsAllowed) {
      items.push({ kind: 'revisions-exceeded', severity: 'warn', title: `${ph.name}: ${ph.revisionsUsed} revisions used of ${ph.revisionsAllowed} included`, detail: `${title(ph.projectId)} — extra revisions are chargeable`, href: `/dashboard/projects/${ph.projectId}?tab=plan`, date: ph.dueDate ?? today });
    }
  }
  for (const dsc of d.discussions) {
    for (const a of dsc.actionItems) {
      if (!a.done && a.due && a.due <= addDays(today, 2)) {
        items.push({ kind: 'action-item', severity: a.due < today ? 'danger' : 'warn', title: a.text, detail: `${a.owner || 'Unassigned'} · ${title(dsc.projectId)}${a.due < today ? ' · overdue' : ''}`, href: `/dashboard/projects/${dsc.projectId}?tab=discussions`, date: a.due });
      }
    }
  }
  const rank = { danger: 0, warn: 1 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity] || a.date.localeCompare(b.date));
}
