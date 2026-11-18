/**
 * Deadline changes. A deadline is never silently overwritten: every change
 * keeps the original date and appends a history entry (from → to, why, and the
 * discussion that caused it), so slips can be traced back to their cause.
 */
import type { DateChange, Phase, Project } from '@/lib/schemas';
import { addDays, daysBetween } from '@/lib/format';

export interface ShiftInput {
  /** new date, or a number of days to move the current date by */
  to?: string;
  byDays?: number;
  reason: string;
  discussionId?: string;
  at: string;
}

/** Resolve the target date for a shift. */
export function shiftTarget(current: string | null, input: Pick<ShiftInput, 'to' | 'byDays'>): string | null {
  if (input.to) return input.to;
  if (input.byDays !== undefined && current) return addDays(current, input.byDays);
  return null;
}

/** Phase with a moved due date, original date preserved and history appended. */
export function shiftPhaseDeadline(phase: Phase, input: ShiftInput): Phase {
  const to = shiftTarget(phase.dueDate, input);
  if (!to || to === phase.dueDate) return phase;
  const change: DateChange = { changedAt: input.at, from: phase.dueDate, to, reason: input.reason, ...(input.discussionId ? { discussionId: input.discussionId } : {}) };
  return {
    ...phase,
    originalDueDate: phase.originalDueDate ?? phase.dueDate,
    dueDate: to,
    dueDateHistory: [...phase.dueDateHistory, change]
  };
}

/** Project with a moved overall deadline, same rules. */
export function shiftProjectDeadline(project: Project, input: ShiftInput): Project {
  const to = shiftTarget(project.currentDeadline, input);
  if (!to || to === project.currentDeadline) return project;
  const change: DateChange = { changedAt: input.at, from: project.currentDeadline, to, reason: input.reason, ...(input.discussionId ? { discussionId: input.discussionId } : {}) };
  return {
    ...project,
    originalDeadline: project.originalDeadline ?? project.currentDeadline,
    currentDeadline: to,
    deadlineHistory: [...project.deadlineHistory, change]
  };
}

/**
 * When a phase slips, later phases (by order) slip by the same number of days —
 * the "day for day" rule in the agreement. Returns the phases that changed.
 */
export function cascadeShift(phases: Phase[], changedPhaseId: string, days: number, input: Omit<ShiftInput, 'to' | 'byDays'>): Phase[] {
  const changed = phases.find((p) => p.id === changedPhaseId);
  if (!changed || days === 0) return [];
  return phases
    .filter((p) => p.projectId === changed.projectId && p.order > changed.order && p.dueDate && p.status !== 'delivered' && p.status !== 'approved')
    .map((p) => {
      const moved = shiftPhaseDeadline(p, { ...input, byDays: days, reason: `${input.reason} (follows ${changed.name})` });
      return p.startDate ? { ...moved, startDate: addDays(p.startDate, days) } : moved;
    });
}

/** Total slip of a phase or project against its original date, in days. */
export function slipDays(original: string | null, current: string | null): number {
  if (!original || !current) return 0;
  return daysBetween(original, current);
}
