import { PhaseSchema, ProjectSchema, type Phase, type Project } from '@/lib/schemas';
import { cascadeShift, shiftPhaseDeadline, shiftProjectDeadline } from '@/lib/logic/deadlines';
import { daysBetween, formatDate } from '@/lib/format';
import { clientIdOfProject, getDb, logActivity, mustFind, mutate, newId, nowIso } from './db';

export type ProjectInput = Omit<Project, 'id' | 'createdAt' | 'deadlineHistory' | 'originalDeadline'> & { originalDeadline?: string | null };
export type PhaseInput = Omit<Phase, 'id' | 'projectId' | 'dueDateHistory' | 'originalDueDate' | 'order'> & { order?: number };

export async function getProjects(): Promise<Project[]> {
  return [...(await getDb()).projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function getProject(id: string): Promise<Project | null> {
  return (await getDb()).projects.find((p) => p.id === id) ?? null;
}
export async function getProjectsForClient(clientId: string): Promise<Project[]> {
  return (await getProjects()).filter((p) => p.clientId === clientId);
}

export async function createProject(input: ProjectInput, phases: PhaseInput[] = []): Promise<Project> {
  const id = newId();
  const project = ProjectSchema.parse({
    ...input, id, createdAt: nowIso(), deadlineHistory: [],
    originalDeadline: input.originalDeadline ?? input.currentDeadline
  });
  const rows = phases.map((p, i) => PhaseSchema.parse({ ...p, id: newId(), projectId: id, order: p.order ?? i, dueDateHistory: [], originalDueDate: p.dueDate }));
  return mutate((db) => {
    db.projects.push(project);
    db.phases.push(...rows);
    logActivity(db, 'project-created', `Project created: ${project.title}`, id, project.clientId);
    return project;
  });
}

export async function updateProject(id: string, patch: Partial<Omit<ProjectInput, 'currentDeadline'>>): Promise<Project> {
  return mutate((db) => {
    const p = mustFind(db.projects, id, 'Project');
    const before = p.status;
    const clean = ProjectSchema.omit({ id: true, createdAt: true, deadlineHistory: true, currentDeadline: true, originalDeadline: true }).partial().parse(patch);
    Object.assign(p, clean);
    if (clean.status && clean.status !== before) logActivity(db, 'project-status', `${p.title}: status ${before} → ${clean.status}`, id, p.clientId);
    return p;
  });
}

/** Move the overall deadline, keeping the original and a reasoned history entry. */
export async function changeProjectDeadline(id: string, to: string, reason: string, discussionId?: string): Promise<Project> {
  return mutate((db) => {
    const i = db.projects.findIndex((p) => p.id === id);
    const p = mustFind(db.projects, id, 'Project');
    const next = shiftProjectDeadline(p, { to, reason, discussionId, at: nowIso() });
    db.projects[i] = next;
    if (next !== p) logActivity(db, 'deadline-changed', `${p.title}: deadline ${formatDate(p.currentDeadline)} → ${formatDate(to)} — ${reason}`, id, p.clientId);
    return next;
  });
}

export async function deleteProject(id: string): Promise<void> {
  await mutate((db) => {
    db.projects = db.projects.filter((p) => p.id !== id);
    db.phases = db.phases.filter((x) => x.projectId !== id);
    db.discussions = db.discussions.filter((x) => x.projectId !== id);
    db.requirements = db.requirements.filter((x) => x.projectId !== id);
    db.tasks = db.tasks.filter((x) => x.projectId !== id);
    db.agreements = db.agreements.filter((x) => x.projectId !== id);
    db.payments = db.payments.filter((x) => x.projectId !== id);
    db.documents = db.documents.filter((x) => x.projectId !== id);
  });
}

/* ---------- phases ---------- */
export async function getPhases(projectId?: string): Promise<Phase[]> {
  const all = (await getDb()).phases;
  return (projectId ? all.filter((p) => p.projectId === projectId) : [...all]).sort((a, b) => a.order - b.order);
}

export async function createPhase(projectId: string, input: PhaseInput): Promise<Phase> {
  return mutate((db) => {
    const order = input.order ?? db.phases.filter((p) => p.projectId === projectId).length;
    const phase = PhaseSchema.parse({ ...input, id: newId(), projectId, order, dueDateHistory: [], originalDueDate: input.dueDate });
    db.phases.push(phase);
    return phase;
  });
}

export async function updatePhase(id: string, patch: Partial<Omit<PhaseInput, 'dueDate'>>): Promise<Phase> {
  return mutate((db) => {
    const ph = mustFind(db.phases, id, 'Phase');
    Object.assign(ph, PhaseSchema.omit({ id: true, projectId: true, dueDate: true, dueDateHistory: true, originalDueDate: true }).partial().parse(patch));
    return ph;
  });
}

export interface PhaseDeadlineChange {
  phaseId: string;
  to: string;
  reason: string;
  /** move later phases by the same number of days */
  cascade: boolean;
  /** move the project deadline by the same number of days */
  moveProject: boolean;
  discussionId?: string;
}

/** Shared by the phase editor and the scope-change flow. Mutates `db`. */
export function applyPhaseDeadlineChange(db: import('@/lib/schemas').Database, c: PhaseDeadlineChange): number {
  const at = nowIso();
  const i = db.phases.findIndex((p) => p.id === c.phaseId);
  const phase = mustFind(db.phases, c.phaseId, 'Phase');
  if (!phase.dueDate || phase.dueDate === c.to) {
    if (!phase.dueDate) db.phases[i] = shiftPhaseDeadline(phase, { to: c.to, reason: c.reason, discussionId: c.discussionId, at });
    return 0;
  }
  const days = daysBetween(phase.dueDate, c.to);
  db.phases[i] = shiftPhaseDeadline(phase, { to: c.to, reason: c.reason, discussionId: c.discussionId, at });
  const clientId = clientIdOfProject(db, phase.projectId);
  logActivity(db, 'deadline-changed', `${phase.name}: due ${formatDate(phase.dueDate)} → ${formatDate(c.to)} (${days > 0 ? '+' : ''}${days} days) — ${c.reason}`, phase.projectId, clientId);
  if (c.cascade) {
    for (const moved of cascadeShift(db.phases, phase.id, days, { reason: c.reason, discussionId: c.discussionId, at })) {
      db.phases[db.phases.findIndex((p) => p.id === moved.id)] = moved;
    }
  }
  if (c.moveProject) {
    const pi = db.projects.findIndex((p) => p.id === phase.projectId);
    const project = db.projects[pi];
    if (project?.currentDeadline) db.projects[pi] = shiftProjectDeadline(project, { byDays: days, reason: c.reason, discussionId: c.discussionId, at });
  }
  return days;
}

export async function changePhaseDeadline(change: PhaseDeadlineChange): Promise<number> {
  return mutate((db) => applyPhaseDeadlineChange(db, change));
}

export async function deletePhase(id: string): Promise<void> {
  await mutate((db) => {
    db.phases = db.phases.filter((p) => p.id !== id);
    db.tasks.forEach((t) => { if (t.phaseId === id) t.phaseId = null; });
  });
}
