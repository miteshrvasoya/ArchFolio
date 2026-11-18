'use client';
import { useState, type FormEvent } from 'react';
import { ClientSchema, ClientSource, ClientStatus, type Client } from '@/lib/schemas';
import { createClient, updateClient, type ClientInput } from '@/lib/repositories';
import { label } from '@/lib/format';
import { Field, issuesToErrors, splitList, useAction } from '../ui';

const empty: ClientInput = { name: '', phone: '', email: '', address: '', city: 'Surat', source: 'referral', notes: '', tags: [], status: 'lead' };

export function ClientForm({ client, onDone }: { client?: Client; onDone: (c: Client) => void }) {
  const [v, setV] = useState<ClientInput>(client ? { ...client } : empty);
  const [tags, setTags] = useState((client?.tags ?? []).join(', '));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const set = <K extends keyof ClientInput>(k: K, val: ClientInput[K]) => setV((s) => ({ ...s, [k]: val }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = { ...v, tags: splitList(tags) };
    const check = ClientSchema.omit({ id: true, createdAt: true }).safeParse(input);
    if (!check.success) { setErrors(issuesToErrors(check.error.issues)); return; }
    setErrors({});
    const saved = await run(() => (client ? updateClient(client.id, input) : createClient(input)), client ? 'Client updated' : 'Client added');
    if (saved) onDone(saved);
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="form-grid">
        <Field label="Name *" error={errors.name} className="full">{(id, d) => <input id={id} aria-describedby={d} value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus />}</Field>
        <Field label="Phone / WhatsApp">{(id) => <input id={id} type="tel" inputMode="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 …" />}</Field>
        <Field label="Email" error={errors.email}>{(id, d) => <input id={id} type="email" aria-describedby={d} value={v.email} onChange={(e) => set('email', e.target.value)} />}</Field>
        <Field label="Address">{(id) => <input id={id} value={v.address} onChange={(e) => set('address', e.target.value)} />}</Field>
        <Field label="City">{(id) => <input id={id} value={v.city} onChange={(e) => set('city', e.target.value)} />}</Field>
        <Field label="Source">{(id) => (
          <select id={id} value={v.source} onChange={(e) => set('source', e.target.value as ClientInput['source'])}>
            {ClientSource.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
          </select>
        )}</Field>
        <Field label="Status">{(id) => (
          <select id={id} value={v.status} onChange={(e) => set('status', e.target.value as ClientInput['status'])}>
            {ClientStatus.options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
          </select>
        )}</Field>
        <Field label="Tags" hint="Comma separated" className="full">{(id, d) => <input id={id} aria-describedby={d} value={tags} onChange={(e) => setTags(e.target.value)} />}</Field>
        <Field label="Notes" className="full">{(id) => <textarea id={id} value={v.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />}</Field>
      </div>
      <div className="form-actions"><button type="submit" className="btn primary" disabled={busy}>{client ? 'Save changes' : 'Add client'}</button></div>
    </form>
  );
}
