'use client';
/** Shared dashboard UI primitives (plain CSS classes from app/dashboard/dashboard.css). */
import Link from 'next/link';
import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type ReactElement, type ReactNode
} from 'react';
import { formatDate, formatINR, label as humanize } from '@/lib/format';

/* ---------- layout ---------- */
export function PageHead({ eyebrow, title, crumbs, actions }: { eyebrow?: string; title: ReactNode; crumbs?: { href: string; label: string }[]; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.href}>{i > 0 && ' / '}<Link href={c.href}>{c.label}</Link></span>
            ))}
          </nav>
        )}
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && <h2>{title}{action}</h2>}
      {children}
    </section>
  );
}

/* ---------- values ---------- */
export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'terra';
export function Chip({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`chip ${tone}`} title={title}>{children}</span>;
}
export function StatusChip({ value, tones }: { value: string; tones: Record<string, Tone> }) {
  return <Chip tone={tones[value] ?? 'neutral'}>{humanize(value)}</Chip>;
}
export const Money = ({ value, className = '' }: { value: number | null | undefined; className?: string }) => <span className={`mono nowrap ${className}`}>{formatINR(value)}</span>;
export const DateText = ({ value }: { value: string | null | undefined }) => <span className="nowrap">{formatDate(value)}</span>;
export function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return <span>{tags.map((t) => <span key={t} className="tag">{t}</span>)}</span>;
}

/* ---------- states ---------- */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty" role="status"><strong>{title}</strong>{children}{action && <div>{action}</div>}</div>;
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading" role="status" aria-live="polite">{label}</div>;
}
export function ErrorState({ error }: { error: Error }) {
  return <div className="form-error" role="alert"><strong>Something went wrong.</strong> {error.message}</div>;
}
/** Render loading / error / content for a data hook. */
export function Async<T>({ state, children, loading }: { state: { data: T | undefined; error: Error | null; loading: boolean }; children: (data: T) => ReactNode; loading?: ReactNode }) {
  if (state.error) return <ErrorState error={state.error} />;
  if (state.data === undefined) return <>{loading ?? <Loading />}</>;
  return <>{children(state.data)}</>;
}

/* ---------- form fields ---------- */
export function Field({ label, error, hint, children, className = '' }: { label: string; error?: string | null; hint?: ReactNode; children: (id: string, describedBy?: string) => ReactElement; className?: string }) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`} data-invalid={error ? 'true' : undefined}>
      <label htmlFor={id}>{label}</label>
      {children(id, describedBy)}
      {hint && !error && <span className="hint" id={hintId}>{hint}</span>}
      {error && <span className="err" id={errId} role="alert">{error}</span>}
    </div>
  );
}

/** Comma-separated list editing helper. */
export const splitList = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);
export const splitLines = (s: string): string[] => s.split('\n').map((x) => x.trim()).filter(Boolean);

/** Map zod issues to { fieldPath: message }. */
export function issuesToErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) { const k = i.path.map(String).join('.'); if (!out[k]) out[k] = i.message; }
  return out;
}

/* ---------- modal ---------- */
export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal${wide ? ' wide' : ''}`} aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <>
          <div className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn ghost small" onClick={onClose} aria-label="Close dialog">✕</button>
          </div>
          <div className="modal-body">{children}</div>
        </>
      )}
    </dialog>
  );
}

/* ---------- toasts + confirm (one provider) ---------- */
interface ConfirmOptions { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }
interface Ui {
  toast: (message: string, kind?: 'info' | 'error') => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
}
const UiContext = createContext<Ui | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: 'info' | 'error' }[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);
  const toast = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), []);
  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);
  const close = (v: boolean) => { pending?.resolve(v); setPending(null); };
  return (
    <UiContext.Provider value={value}>
      {children}
      <Modal open={!!pending} onClose={() => close(false)} title={pending?.title ?? ''}>
        <div style={{ fontFamily: 'var(--f-text)', fontSize: '1rem' }}>{pending?.message}</div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => close(false)}>Cancel</button>
          <button type="button" className={`btn ${pending?.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>{pending?.confirmLabel ?? 'Confirm'}</button>
        </div>
      </Modal>
      <div className="toasts" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.message}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </UiContext.Provider>
  );
}

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error('useUi outside UiProvider');
  return ui;
}

/** Run an async action with busy state and error toasts. */
export function useAction() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}

/* ---------- sorting ---------- */
export function useSort<T>(items: T[], initial: { key: string; dir: 'asc' | 'desc' }, accessors: Record<string, (x: T) => string | number>) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    const get = accessors[sort.key];
    if (!get) return items;
    return [...items].sort((a, b) => {
      const x = get(a), y = get(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.dir === 'asc' ? c : -c;
    });
  }, [items, sort, accessors]);
  const header = (key: string, text: string) => (
    <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))} aria-label={`Sort by ${text}`}>
      {text}{sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </button>
  );
  const ariaSort = (key: string): 'ascending' | 'descending' | 'none' => (sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  return { sorted, header, ariaSort };
}

/* ---------- download helper ---------- */
export function downloadFile(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    return ok;
  }
}
