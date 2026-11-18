'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SettingsSchema, type Settings } from '@/lib/schemas';
import { exportAll, getSettings, importAll, resetToSample, updateSettings } from '@/lib/repositories';
import { STORAGE_KEY } from '@/lib/storage';
import { todayIST } from '@/lib/format';
import { useData, useDataVersion } from '@/lib/hooks/useData';
import { Async, Card, Field, PageHead, downloadFile, issuesToErrors, useAction, useUi } from '@/components/dashboard/ui';

export default function SettingsPage() {
  const state = useData(() => getSettings());
  return (
    <>
      <PageHead eyebrow="Studio" title="Settings" />
      <div className="grid side-main">
        <Async state={state}>{(s) => <SettingsForm key={JSON.stringify(s).length} initial={s} />}</Async>
        <div className="stack"><DataCard /><SecurityCard /></div>
      </div>
    </>
  );
}

function SettingsForm({ initial }: { initial: Settings }) {
  const [s, setS] = useState<Settings>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const firm = (k: keyof Settings['firm'], v: string) => setS((x) => ({ ...x, firm: { ...x.firm, [k]: v } }));
  const bank = (k: keyof Settings['bank'], v: string) => setS((x) => ({ ...x, bank: { ...x.bank, [k]: v } }));
  const def = (k: keyof Settings['defaults'], v: string | string[]) => setS((x) => ({ ...x, defaults: { ...x.defaults, [k]: v } }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = SettingsSchema.safeParse(s);
    if (!parsed.success) { setErrors(issuesToErrors(parsed.error.issues)); return; }
    setErrors({});
    await run(() => updateSettings(parsed.data), 'Settings saved');
  };
  const F = (k: keyof Settings['firm'], label: string, hint?: string) => (
    <Field key={k} label={label} hint={hint} error={errors[`firm.${k}`]}>{(id, d) => <input id={id} aria-describedby={d} value={s.firm[k]} onChange={(e) => firm(k, e.target.value)} />}</Field>
  );
  const B = (k: keyof Settings['bank'], label: string) => (
    <Field key={k} label={label}>{(id) => <input id={id} value={s.bank[k]} onChange={(e) => bank(k, e.target.value)} />}</Field>
  );
  const D = (k: Exclude<keyof Settings['defaults'], 'paymentModes'>, label: string, rows = 3) => (
    <Field key={k} label={label} className="full">{(id) => <textarea id={id} rows={rows} value={s.defaults[k]} onChange={(e) => def(k, e.target.value)} />}</Field>
  );
  return (
    <form onSubmit={submit} noValidate className="stack">
      <Card title="Firm profile">
        <div className="form-grid">
          {F('name', 'Firm name')}{F('architectName', 'Architect')}
          {F('coaNumber', 'COA registration no.')}{F('gstin', 'GSTIN (optional)')}
          {F('phone', 'Phone / WhatsApp', 'Clients send acceptance receipts here')}{F('email', 'Email')}
          {F('address', 'Address')}{F('city', 'City')}
          {F('website', 'Website')}{F('logoUrl', 'Logo URL', 'Shown on agreements')}
        </div>
      </Card>
      <Card title="Bank and UPI (for payment requests)">
        <div className="form-grid">
          {B('accountName', 'Account name')}{B('bankName', 'Bank')}
          {B('accountNumber', 'Account number')}{B('ifsc', 'IFSC')}
          {B('upiId', 'UPI ID')}
        </div>
      </Card>
      <Card title="Default agreement clauses">
        <p className="muted" style={{ marginTop: 0 }}>Used for new agreements created from a template. Existing agreements keep their own text.</p>
        <div className="form-grid">
          <Field label="Payment modes" hint="Comma separated" className="full">{(id, d) => <input id={id} aria-describedby={d} value={s.defaults.paymentModes.join(', ')} onChange={(e) => def('paymentModes', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />}</Field>
          {D('latePaymentTerms', 'Late payment terms')}
          {D('dependencyClause', 'Timeline dependency', 4)}
          {D('changeClause', 'How changes revise the timeline', 4)}
          {D('ownershipClause', 'Ownership and usage rights', 4)}
          {D('fileReleaseClause', 'Release of files')}
          {D('terminationClause', 'Cancellation / termination', 4)}
          {D('confidentiality', 'Confidentiality')}
          {D('disputeResolution', 'Dispute resolution', 4)}
          {D('governingLaw', 'Governing law', 1)}
        </div>
        <p className="disclaimer">Template for convenience; have a qualified advocate review before relying on it.</p>
      </Card>
      <div className="form-actions" style={{ position: 'sticky', bottom: 0, background: 'var(--bg-soft)', padding: '0.5rem 0' }}>
        {Object.keys(errors).length > 0 && <span className="total-bad" role="alert">Some fields are too long or invalid.</span>}
        <button type="submit" className="btn primary" disabled={busy}>Save settings</button>
      </div>
    </form>
  );
}

function DataCard() {
  const { run, busy } = useAction();
  const { confirm, toast } = useUi();
  const file = useRef<HTMLInputElement>(null);
  const [usage, setUsage] = useState<string>('');
  const version = useDataVersion();
  useEffect(() => {
    try { setUsage(`${((localStorage.getItem(STORAGE_KEY)?.length ?? 0) / 1024).toFixed(0)} KB used in this browser`); } catch { setUsage('Browser storage unavailable'); }
  }, [version]);
  const onImport = async (f: File) => {
    const text = await f.text();
    if (!(await confirm({ title: 'Replace all data?', message: `Everything in this browser is replaced with the contents of “${f.name}”. Export a backup first if you might need the current data.`, confirmLabel: 'Import and replace', danger: true }))) return;
    const res = await run(() => importAll(text));
    if (!res) return;
    if (res.ok) toast(`Imported: ${Object.entries(res.counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    else toast(res.error, 'error');
  };
  return (
    <Card title="Your data">
      <p className="muted" style={{ marginTop: 0 }}>Everything is stored only in this browser ({usage}). Export regularly to back it up or move it to another device.</p>
      <div className="actions">
        <button type="button" className="btn primary" disabled={busy} onClick={async () => { const json = await exportAll(); downloadFile(`pln-dashboard-backup-${todayIST()}.json`, json); toast('Backup downloaded'); }}>Export all (JSON)</button>
        <button type="button" className="btn" disabled={busy} onClick={() => file.current?.click()}>Import backup…</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onImport(f); }} />
      </div>
      <hr style={{ border: 0, borderTop: '1px solid var(--sage-faint)', margin: '1rem 0' }} />
      <button type="button" className="btn danger small" disabled={busy} onClick={async () => {
        if (await confirm({ title: 'Reset to sample data?', message: 'All your clients, projects, agreements and payments in this browser are replaced by the sample data. This cannot be undone — export a backup first.', confirmLabel: 'Reset', danger: true })) run(() => resetToSample(), 'Sample data loaded');
      }}>Reset to sample data</button>
    </Card>
  );
}

function SecurityCard() {
  return (
    <Card title="About privacy">
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontFamily: 'var(--f-text)', fontSize: '0.95rem' }}>
        <li>The passcode lock is a convenience, not security — it is part of the website’s public code.</li>
        <li>Data never leaves this browser except when you export it or share an agreement link (which contains only that agreement).</li>
        <li>Clearing browser data deletes the dashboard data. Keep exported backups somewhere safe.</li>
      </ul>
    </Card>
  );
}
