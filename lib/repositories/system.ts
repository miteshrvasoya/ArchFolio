/** Settings, activity, global search, and export / import / reset of all data. */
import { SettingsSchema, SCHEMA_VERSION, type Activity, type Settings } from '@/lib/schemas';
import { migrate } from '@/lib/storage';
import { getDb, logActivity, mutate, replaceDb, resetDb } from './db';
import { latest } from './agreements';

export async function getSettings(): Promise<Settings> {
  return (await getDb()).settings;
}
export async function updateSettings(next: Settings): Promise<Settings> {
  const clean = SettingsSchema.parse(next);
  return mutate((db) => { db.settings = clean; return clean; });
}

export async function getActivity(limit = 50, projectId?: string): Promise<Activity[]> {
  const all = (await getDb()).activity;
  return (projectId ? all.filter((a) => a.projectId === projectId) : all).slice(0, limit);
}

export interface SearchHit { kind: 'client' | 'project' | 'agreement'; id: string; title: string; subtitle: string; href: string }

export async function search(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const db = await getDb();
  const has = (...fields: (string | null | undefined)[]) => fields.some((f) => f?.toLowerCase().includes(q));
  const hits: SearchHit[] = [];
  for (const c of db.clients) if (has(c.name, c.phone, c.email, c.city, c.tags.join(' '))) hits.push({ kind: 'client', id: c.id, title: c.name, subtitle: [c.city, c.status].filter(Boolean).join(' · '), href: `/dashboard/clients/${c.id}` });
  for (const p of db.projects) if (has(p.title, p.siteLocation, p.tags.join(' '))) hits.push({ kind: 'project', id: p.id, title: p.title, subtitle: `${p.type} · ${p.status}`, href: `/dashboard/projects/${p.id}` });
  for (const a of db.agreements) if (has(a.title, latest(a).content.parties.client.name)) hits.push({ kind: 'agreement', id: a.id, title: a.title, subtitle: `v${latest(a).version} · ${latest(a).status}`, href: `/dashboard/agreements/${a.id}` });
  return hits.slice(0, 20);
}

/** Everything, as a JSON backup file. */
export async function exportAll(): Promise<string> {
  const db = await getDb();
  return JSON.stringify({ app: 'pln-dashboard', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: db }, null, 2);
}

export type ImportResult = { ok: true; counts: Record<string, number> } | { ok: false; error: string };

/** Replace all data with a backup file (validated, and migrated if older). */
export async function importAll(json: string): Promise<ImportResult> {
  if (json.length > 25_000_000) return { ok: false, error: 'The file is too large to be a dashboard backup.' };
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { ok: false, error: 'The file is not valid JSON.' }; }
  const envelope = parsed as { app?: unknown; data?: unknown };
  if (!envelope || envelope.app !== 'pln-dashboard') return { ok: false, error: 'This is not a dashboard backup file.' };
  const result = migrate(envelope.data);
  if (!result.ok) return { ok: false, error: result.error };
  const db = result.db;
  logActivity(db, 'data-imported', 'Data imported from a backup file');
  await replaceDb(db);
  return { ok: true, counts: { clients: db.clients.length, projects: db.projects.length, agreements: db.agreements.length, payments: db.payments.length } };
}

export async function resetToSample(): Promise<void> {
  await resetDb();
}
