/**
 * The bundled sample data (data/seed/*.json — fake data only; anything imported
 * here ships in the public JavaScript bundle). Dates are rebased to today.
 */
import meta from '@/data/seed/meta.json';
import clients from '@/data/seed/clients.json';
import projects from '@/data/seed/projects.json';
import phases from '@/data/seed/phases.json';
import discussions from '@/data/seed/discussions.json';
import requirements from '@/data/seed/requirements.json';
import tasks from '@/data/seed/tasks.json';
import agreements from '@/data/seed/agreements.json';
import templates from '@/data/seed/agreement-templates.json';
import payments from '@/data/seed/payments.json';
import documents from '@/data/seed/documents.json';
import activity from '@/data/seed/activity.json';
import settings from '@/data/seed/settings.json';
import { DatabaseSchema, SCHEMA_VERSION, type Database } from '@/lib/schemas';
import { rebaseDates } from '@/lib/logic/seed';
import { todayIST } from '@/lib/format';
import { contentHash } from '@/lib/sharing/hash';

/** Sample database, validated and rebased so its dates sit around `today`. */
export async function sampleDatabase(today: string = todayIST()): Promise<Database> {
  const raw = {
    schemaVersion: SCHEMA_VERSION, clients, projects, phases, discussions, requirements, tasks,
    agreements, templates, payments, documents, activity, settings
  };
  const db = DatabaseSchema.parse(rebaseDates(raw, meta.anchorDate, today));
  // accepted sample versions carry a hash of their (rebased) content
  for (const a of db.agreements) {
    for (const v of a.versions) if (v.acceptanceHash) v.acceptanceHash = await contentHash(v.content);
  }
  return db;
}
