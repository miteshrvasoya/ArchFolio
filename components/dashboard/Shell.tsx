'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { getLoadError, getPayments, getSettings, invalidate, resetToSample, search, type SearchHit } from '@/lib/repositories';
import { STORAGE_KEY } from '@/lib/storage';
import { summarisePayment } from '@/lib/logic/payments';
import { useData } from '@/lib/hooks/useData';
import { PasscodeGate, lockDashboard } from './PasscodeGate';
import { UiProvider, useUi, downloadFile } from './ui';

const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/clients', label: 'Clients' },
  { href: '/dashboard/projects', label: 'Projects' },
  { href: '/dashboard/agreements', label: 'Agreements' },
  { href: '/dashboard/payments', label: 'Payments', badge: 'overdue' },
  { href: '/dashboard/discussions', label: 'Discussions' },
  { href: '/dashboard/calendar', label: 'Deadlines' },
  { href: '/dashboard/settings', label: 'Settings' }
] as const;

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <div className="dash-root">
      <PasscodeGate>
        <UiProvider>
          <Frame>{children}</Frame>
        </UiProvider>
      </PasscodeGate>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const settings = useData(() => getSettings());
  const overdue = useData(async () => (await getPayments()).filter((p) => summarisePayment(p).overdue).length);

  // another tab changed the data
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) invalidate(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);

  const isActive = (href: string) => (href === '/dashboard' ? pathname === href : pathname.startsWith(href));

  return (
    <div className="dash">
      <a className="skip-link" href="#main">Skip to content</a>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`side${open ? ' open' : ''}`} aria-label="Dashboard navigation">
        <Link className="brand" href="/dashboard"><span className="dot" aria-hidden="true" />PLN<span className="sub">studio</span></Link>
        <div className="side-label">Practice</div>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? 'page' : undefined}>
              <span>{n.label}</span>
              {'badge' in n && (overdue.data ?? 0) > 0 && <span className="count" aria-label={`${overdue.data} overdue`}>{overdue.data}</span>}
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          <span>Data is stored in this browser. Back it up from Settings.</span>
          <button type="button" className="btn small" onClick={lockDashboard}>Lock</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn small menu-btn" onClick={() => setOpen(true)} aria-label="Open navigation" aria-expanded={open}>☰</button>
          <GlobalSearch />
          <span className="faint nowrap" style={{ fontSize: '0.72rem' }}>{settings.data?.firm.name}</span>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {settings.error ? <Recovery /> : children}
        </main>
      </div>
    </div>
  );
}

/** Shown when stored data cannot be read: never overwrite it silently. */
function Recovery() {
  const { confirm, toast } = useUi();
  const err = getLoadError();
  const downloadBackup = () => {
    const raw = err?.backupKey ? localStorage.getItem(err.backupKey) : localStorage.getItem(STORAGE_KEY);
    if (raw) downloadFile('dashboard-unreadable-data.json', raw);
  };
  return (
    <div className="card ink" role="alert" style={{ maxWidth: 640 }}>
      <h2>Your saved data could not be read</h2>
      <p>{err?.error ?? 'The stored data is damaged or from an incompatible version.'}</p>
      <p className="muted">A copy was kept in this browser. Download it before doing anything else, then restore a backup from Settings or start again from the sample data.</p>
      <div className="actions">
        <button type="button" className="btn" onClick={downloadBackup}>Download the unreadable data</button>
        <button type="button" className="btn danger" onClick={async () => {
          if (await confirm({ title: 'Start again with sample data?', message: 'This replaces the saved data in this browser with the sample. Download the unreadable data first if you might need it.', confirmLabel: 'Reset', danger: true })) {
            await resetToSample(); toast('Sample data loaded'); invalidate();
          }
        }}>Reset to sample data</button>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [show, setShow] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    search(q).then((h) => { if (alive) { setHits(h); setActive(0); } }).catch(() => {});
    return () => { alive = false; };
  }, [q]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !/input|textarea|select/i.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (h: SearchHit) => { setShow(false); setQ(''); router.push(h.href); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); go(hits[active]); }
    else if (e.key === 'Escape') { setShow(false); }
  };
  const listId = 'search-results';
  return (
    <div className="search" role="search">
      <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m13 13 5 5" stroke="currentColor" strokeWidth="2" /></svg>
      <label htmlFor="global-search" className="sr-only">Search clients, projects and agreements</label>
      <input
        id="global-search" ref={input} type="search" placeholder="Search clients, projects, agreements  ( / )" value={q}
        onChange={(e) => { setQ(e.target.value); setShow(true); }} onFocus={() => setShow(true)} onBlur={() => setTimeout(() => setShow(false), 150)} onKeyDown={onKey}
        role="combobox" aria-expanded={show && hits.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={show && hits[active] ? `hit-${hits[active].kind}-${hits[active].id}` : undefined} autoComplete="off"
      />
      {show && q.trim().length >= 2 && (
        <div className="search-results" id={listId} role="listbox" aria-label="Search results">
          {hits.length === 0 ? <div className="loading">No matches for “{q}”.</div> : hits.map((h, i) => (
            <a key={`${h.kind}-${h.id}`} id={`hit-${h.kind}-${h.id}`} href={h.href} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); go(h); }}>
              <span className="kind">{h.kind}</span>
              <span>{h.title}<small>{h.subtitle}</small></span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
