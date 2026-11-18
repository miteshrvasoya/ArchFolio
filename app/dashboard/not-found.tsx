import Link from 'next/link';

export default function DashboardNotFound() {
  return (
    <div className="empty">
      <strong>This page does not exist</strong>
      <Link className="btn" href="/dashboard">Back to overview</Link>
    </div>
  );
}
