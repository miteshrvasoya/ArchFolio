/** Discussions, requirements & references, tasks and documents. */
import {
  DiscussionSchema, DocumentSchema, RequirementSchema, TaskSchema,
  type Discussion, type Doc, type Requirement, type Task
} from '@/lib/schemas';
import { formatINR } from '@/lib/format';
import { clientIdOfProject, getDb, logActivity, mustFind, mutate, newId, nowIso } from './db';
import { applyPhaseDeadlineChange, type PhaseDeadlineChange } from './projects';

const byProject = <T extends { projectId: string }>(list: T[], projectId?: string) =>
  projectId ? list.filter((x) => x.projectId === projectId) : [...list];

/* ---------- discussions ---------- */
export type DiscussionInput = Omit<Discussion, 'id'>;

export async function getDiscussions(projectId?: string): Promise<Discussion[]> {
  return byProject((await getDb()).discussions, projectId).sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Log a discussion. For a scope / reference change, optionally move a phase
 * deadline in the same step: the original date is kept and the change points
 * back at this discussion, so the reason for the slip is on record.
 */
export async function logDiscussion(input: DiscussionInput, deadline?: Omit<PhaseDeadlineChange, 'discussionId'>): Promise<Discussion> {
  const discussion = DiscussionSchema.parse({ ...input, id: newId(), actionItems: input.actionItems.map((a) => ({ ...a, id: a.id || newId() })) });
  return mutate((db) => {
    db.discussions.push(discussion);
    const clientId = clientIdOfProject(db, discussion.projectId);
    if (discussion.scopeChange) {
      const impact = discussion.impact;
      const bits = [impact?.days ? `${impact.days > 0 ? '+' : ''}${impact.days} days` : '', impact?.costInr ? `+${formatINR(impact.costInr)}` : ''].filter(Boolean).join(', ');
      logActivity(db, 'scope-change', `Scope change logged${bits ? ` (${bits})` : ''}: ${discussion.summary.slice(0, 140)}`, discussion.projectId, clientId);
    }
    if (deadline) applyPhaseDeadlineChange(db, { ...deadline, discussionId: discussion.id });
    return discussion;
  });
}

export async function updateDiscussion(id: string, patch: Partial<DiscussionInput>): Promise<Discussion> {
  return mutate((db) => {
    const d = mustFind(db.discussions, id, 'Discussion');
    Object.assign(d, DiscussionSchema.omit({ id: true }).partial().parse(patch));
    return d;
  });
}

export async function toggleActionItem(discussionId: string, itemId: string, done: boolean): Promise<void> {
  await mutate((db) => {
    const d = mustFind(db.discussions, discussionId, 'Discussion');
    const item = d.actionItems.find((a) => a.id === itemId);
    if (item) item.done = done;
  });
}

export async function deleteDiscussion(id: string): Promise<void> {
  await mutate((db) => { db.discussions = db.discussions.filter((d) => d.id !== id); });
}

/* ---------- requirements & references ---------- */
export type RequirementInput = Omit<Requirement, 'id' | 'version'>;

export async function getRequirements(projectId?: string): Promise<Requirement[]> {
  return byProject((await getDb()).requirements, projectId).sort((a, b) => b.receivedOn.localeCompare(a.receivedOn));
}

export async function createRequirement(input: RequirementInput): Promise<Requirement> {
  return mutate((db) => {
    const version = db.requirements.filter((r) => r.projectId === input.projectId && r.category === input.category).length + 1;
    const r = RequirementSchema.parse({ ...input, id: newId(), version });
    db.requirements.push(r);
    return r;
  });
}

export async function deleteRequirement(id: string): Promise<void> {
  await mutate((db) => { db.requirements = db.requirements.filter((r) => r.id !== id); });
}

/* ---------- tasks ---------- */
export type TaskInput = Omit<Task, 'id'>;

export async function getTasks(projectId?: string): Promise<Task[]> {
  return byProject((await getDb()).tasks, projectId).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
}
export async function createTask(input: TaskInput): Promise<Task> {
  const t = TaskSchema.parse({ ...input, id: newId() });
  return mutate((db) => { db.tasks.push(t); return t; });
}
export async function updateTask(id: string, patch: Partial<TaskInput>): Promise<Task> {
  return mutate((db) => {
    const t = mustFind(db.tasks, id, 'Task');
    Object.assign(t, TaskSchema.omit({ id: true }).partial().parse(patch));
    return t;
  });
}
export async function deleteTask(id: string): Promise<void> {
  await mutate((db) => { db.tasks = db.tasks.filter((t) => t.id !== id); });
}

/* ---------- documents (with "release only after payment") ---------- */
export type DocumentInput = Omit<Doc, 'id'>;

export async function getDocuments(projectId?: string): Promise<Doc[]> {
  return byProject((await getDb()).documents, projectId);
}
export async function createDocument(input: DocumentInput): Promise<Doc> {
  const d = DocumentSchema.parse({ ...input, id: newId() });
  return mutate((db) => { db.documents.push(d); return d; });
}
export async function updateDocument(id: string, patch: Partial<DocumentInput>): Promise<Doc> {
  return mutate((db) => {
    const d = mustFind(db.documents, id, 'Document');
    Object.assign(d, DocumentSchema.omit({ id: true }).partial().parse(patch));
    return d;
  });
}
/** Unlock and mark released today. */
export async function releaseDocument(id: string, on: string): Promise<Doc> {
  return mutate((db) => {
    const d = mustFind(db.documents, id, 'Document');
    d.locked = false;
    d.releasedOn = on;
    d.sharedWithClient = true;
    logActivity(db, 'document-released', `Released to client: ${d.name} ${d.version}`, d.projectId, clientIdOfProject(db, d.projectId));
    return d;
  });
}
export async function deleteDocument(id: string): Promise<void> {
  await mutate((db) => { db.documents = db.documents.filter((d) => d.id !== id); });
}

export { nowIso };
