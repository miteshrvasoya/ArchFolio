'use client';
/** Share actions for one agreement version (sharing details: lib/sharing). */
import type { Agreement, AgreementVersion, Settings } from '@/lib/schemas';
import { Card } from '../ui';

export function SharePanel({ version }: { agreement: Agreement; version: AgreementVersion; settings: Settings; clientPhone: string; clientEmail: string; feesValid: boolean }) {
  return (
    <Card title="Share">
      <p className="muted" style={{ marginTop: 0 }}>Version {version.version} · {version.status}</p>
    </Card>
  );
}
