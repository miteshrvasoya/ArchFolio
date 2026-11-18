/**
 * Storage adapters. The repositories talk to a StorageAdapter; today that is
 * the browser's localStorage, and later it can be an HTTP adapter (or the
 * repositories can call an API directly) without the UI noticing.
 *
 * localStorage layout (namespaced and versioned):
 *   pln.dashboard.v1            → { schemaVersion, savedAt, data: Database }
 *   pln.dashboard.backup.<iso>  → raw copy kept when stored data cannot be read
 */
import { DatabaseSchema, SCHEMA_VERSION, type Database } from '@/lib/schemas';
import { sampleDatabase } from './sample';

export const STORAGE_KEY = 'pln.dashboard.v1';
const BACKUP_PREFIX = 'pln.dashboard.backup.';

export type LoadResult =
  | { ok: true; db: Database; source: 'stored' | 'sample' }
  | { ok: false; error: string; backupKey: string | null };

export interface StorageAdapter {
  load(): Promise<LoadResult>;
  save(db: Database): Promise<void>;
  /** Replace stored data with the sample. */
  reset(): Promise<Database>;
}

/**
 * Migrations from schema version n to n + 1. When the schema changes, bump
 * SCHEMA_VERSION and add a function here that upgrades the previous shape.
 */
export const MIGRATIONS: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (d) => ({ ...d, schemaVersion: 2, newField: [] }),
};

/** Upgrade an older export/stored document to the current schema and validate it. */
export function migrate(input: unknown): { ok: true; db: Database } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Not a dashboard data file.' };
  let data = input as Record<string, unknown>;
  let v = typeof data.schemaVersion === 'number' ? data.schemaVersion : NaN;
  if (!Number.isInteger(v)) return { ok: false, error: 'The data has no schema version.' };
  if (v > SCHEMA_VERSION) return { ok: false, error: `The data is from a newer version of the dashboard (schema ${v}).` };
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, error: `No migration from schema ${v}.` };
    data = step(data);
    v += 1;
  }
  const parsed = DatabaseSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `The data does not match the expected format${first ? ` (${first.path.join('.')}: ${first.message})` : ''}.` };
  }
  return { ok: true, db: parsed.data };
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly key: string = STORAGE_KEY) {}

  private get store(): Storage | null {
    try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
  }

  async load(): Promise<LoadResult> {
    const store = this.store;
    const raw = store?.getItem(this.key) ?? null;
    if (raw === null) {
      const db = await sampleDatabase();
      await this.save(db);
      return { ok: true, db, source: 'sample' };
    }
    let envelope: unknown;
    try { envelope = JSON.parse(raw); } catch { envelope = null; }
    const data = envelope && typeof envelope === 'object' ? (envelope as { data?: unknown }).data : undefined;
    const result = migrate(data);
    if (result.ok) return { ok: true, db: result.db, source: 'stored' };
    // never overwrite data we cannot read: keep a copy and let the user decide
    const backupKey = `${BACKUP_PREFIX}${new Date().toISOString()}`;
    try { store?.setItem(backupKey, raw); } catch { /* storage full: nothing more we can do */ }
    return { ok: false, error: result.error, backupKey };
  }

  async save(db: Database): Promise<void> {
    const store = this.store;
    if (!store) return;
    const envelope = { schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), data: db };
    try {
      store.setItem(this.key, JSON.stringify(envelope));
    } catch (e) {
      throw new Error(e instanceof DOMException && e.name === 'QuotaExceededError'
        ? 'Browser storage is full. Export your data and remove large attachments or old notes.'
        : 'Could not save to browser storage.');
    }
  }

  async reset(): Promise<Database> {
    const db = await sampleDatabase();
    await this.save(db);
    return db;
  }
}

/** In-memory adapter for tests and for rendering without a browser. */
export class MemoryAdapter implements StorageAdapter {
  private db: Database | null = null;
  constructor(initial?: Database) { this.db = initial ?? null; }
  async load(): Promise<LoadResult> {
    if (!this.db) { this.db = await sampleDatabase(); return { ok: true, db: structuredClone(this.db), source: 'sample' }; }
    return { ok: true, db: structuredClone(this.db), source: 'stored' };
  }
  async save(db: Database): Promise<void> { this.db = structuredClone(db); }
  async reset(): Promise<Database> { this.db = await sampleDatabase(); return structuredClone(this.db); }
}
