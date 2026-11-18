'use client';
/**
 * PASSCODE GATE — NOT REAL SECURITY.
 *
 * A placeholder until a backend with real authentication exists. The passcode
 * (NEXT_PUBLIC_DASHBOARD_PASSCODE) is compiled into the public JavaScript, so
 * anyone determined can read it; and the dashboard's data lives only in this
 * browser anyway. It keeps casual visitors out of /dashboard, nothing more.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

const KEY = 'pln.dashboard.unlocked';
const PASSCODE = process.env.NEXT_PUBLIC_DASHBOARD_PASSCODE ?? '';

export function PasscodeGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let open = false;
    try { open = sessionStorage.getItem(KEY) === '1'; } catch { /* storage blocked */ }
    setState(open ? 'open' : 'locked');
  }, []);

  if (state === 'checking') return <div className="loading" role="status">Loading…</div>;
  if (state === 'open') return <>{children}</>;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (PASSCODE && value !== PASSCODE) { setError('That passcode is not right.'); return; }
    try { sessionStorage.setItem(KEY, '1'); } catch { /* still let them in for this page view */ }
    setState('open');
  };

  return (
    <main className="gate">
      <form onSubmit={submit} aria-labelledby="gate-title">
        <span className="eyebrow">.PLN architects</span>
        <h1 id="gate-title">Practice dashboard</h1>
        <p>Enter the studio passcode to continue.</p>
        {!PASSCODE && (
          <div className="notice">
            No passcode is configured. Set <code>NEXT_PUBLIC_DASHBOARD_PASSCODE</code> before deploying; until then any entry unlocks.
          </div>
        )}
        <div className="field" data-invalid={error ? 'true' : undefined}>
          <label htmlFor="passcode">Passcode</label>
          <input id="passcode" type="password" autoComplete="current-password" value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} autoFocus />
          {error && <span className="err" role="alert">{error}</span>}
        </div>
        <button type="submit" className="btn primary" style={{ width: '100%' }}>Unlock</button>
        <p className="faint" style={{ fontSize: '0.74rem', marginTop: '1rem', marginBottom: 0 }}>
          This lock is a convenience, not security: data stays in this browser and the passcode is not secret from a determined visitor.
        </p>
      </form>
    </main>
  );
}

export function lockDashboard() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  window.location.reload();
}
