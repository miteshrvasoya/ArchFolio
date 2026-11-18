'use client';
import Link from 'next/link';

/** Error boundary for dashboard pages: never lose the user in a blank screen. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card ink" role="alert" style={{ maxWidth: 620 }}>
      <h2>This page hit a problem</h2>
      <p style={{ fontFamily: 'var(--f-text)' }}>{error.message || 'An unexpected error occurred.'} Your data is safe in this browser.</p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={reset}>Try again</button>
        <Link className="btn" href="/dashboard">Go to overview</Link>
        <Link className="btn" href="/dashboard/settings">Export a backup</Link>
      </div>
    </div>
  );
}
