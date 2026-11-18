import { ClientSchema, type Client } from '@/lib/schemas';
import { getDb, logActivity, mustFind, mutate, newId, nowIso, DataError } from './db';

export type ClientInput = Omit<Client, 'id' | 'createdAt'>;

export async function getClients(): Promise<Client[]> {
  return [...(await getDb()).clients].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getClient(id: string): Promise<Client | null> {
  return (await getDb()).clients.find((c) => c.id === id) ?? null;
}

export async function createClient(input: ClientInput): Promise<Client> {
  const client = ClientSchema.parse({ ...input, id: newId(), createdAt: nowIso() });
  return mutate((db) => {
    db.clients.push(client);
    logActivity(db, 'client-created', `Client added: ${client.name}`, null, client.id);
    return client;
  });
}

export async function updateClient(id: string, patch: Partial<ClientInput>): Promise<Client> {
  return mutate((db) => {
    const c = mustFind(db.clients, id, 'Client');
    Object.assign(c, ClientSchema.omit({ id: true, createdAt: true }).partial().parse(patch));
    return c;
  });
}

export async function deleteClient(id: string): Promise<void> {
  await mutate((db) => {
    if (db.projects.some((p) => p.clientId === id)) throw new DataError('This client has projects. Delete or move them first.');
    db.clients = db.clients.filter((c) => c.id !== id);
  });
}
