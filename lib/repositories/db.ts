/**
 * Repository core: one in-memory copy of the database, loaded through a
 * StorageAdapter, validated on every change, persisted, and broadcast to
 * subscribers (the React hooks). Every repository function is async so the
 * UI already treats data access as remote; swapping in a backend means
 * replacing the repository modules, not the UI.
 */
import { nanoid } from 'nanoid';
import { DatabaseSchema, type Activity, type Database } from '@/lib/schemas';
import { LocalStorageAdapter, type StorageAdapter } from '@/lib/storage';

let adapter: StorageAdapter = new LocalStorageAdapter();
let state: Database | null = null;
let pending: Promise<Database> | null = null;
let loadError: string | null = null;
let backupKey: string | null = null;
let version = 0;
const listeners = new Set<() => void>();

export class DataError extends Error {}

/** Swap the storage (tests, or a future HTTP adapter). */
export function setStorageAdapter(next: StorageAdapter): void {
  adapter = next;
  state = null;
  pending = null;
  loadError = null;
  bump();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getVersion(): number { return version; }
export function getLoadError(): { error: string; backupKey: string | null } | null {
  return loadError ? { error: loadError, backupKey } : null;
}
function bump() { version += 1; listeners.forEach((l) => l()); }

export async function getDb(): Promise<Database> {
  if (state) return state;
  if (!pending) {
    pending = adapter.load().then((r) => {
      if (!r.ok) {
        loadError = r.error;
        backupKey = r.backupKey;
        pending = null;
        throw new DataError(r.error);
      }
      loadError = null;
      state = r.db;
      return r.db;
    });
  }
  return pending;
}

/**
 * Apply a change to a copy of the database, validate the whole result, then
 * persist and notify. Throws (leaving data untouched) if validation fails.
 */
export async function mutate<T>(change: (db: Database) => T): Promise<T> {
  const current = await getDb();
  const draft = structuredClone(current);
  const result = change(draft);
  const parsed = DatabaseSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DataError(issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid data');
  }
  await adapter.save(parsed.data);
  state = parsed.data;
  bump();
  return result;
}

/** Replace everything (import / reset). */
export async function replaceDb(db: Database): Promise<void> {
  const parsed = DatabaseSchema.parse(db);
  await adapter.save(parsed);
  state = parsed;
  loadError = null;
  bump();
}

export async function resetDb(): Promise<Database> {
  const db = await adapter.reset();
  state = db;
  loadError = null;
  bump();
  return db;
}

/** Reload from storage (e.g. another tab changed it). */
export function invalidate(): void {
  state = null;
  pending = null;
  bump();
}

export const newId = (): string => nanoid(12);
export const newToken = (): string => nanoid(24);
export const nowIso = (): string => new Date().toISOString();

export function logActivity(db: Database, kind: Activity['kind'], message: string, projectId: string | null = null, clientId: string | null = null): void {
  db.activity.unshift({ id: newId(), at: nowIso(), kind, message: message.slice(0, 500), projectId, clientId });
  if (db.activity.length > 500) db.activity.length = 500;
}

export function clientIdOfProject(db: Database, projectId: string | null): string | null {
  return db.projects.find((p) => p.id === projectId)?.clientId ?? null;
}

export function mustFind<T extends { id: string }>(list: T[], id: string, what: string): T {
  const item = list.find((x) => x.id === id);
  if (!item) throw new DataError(`${what} not found`);
  return item;
}
