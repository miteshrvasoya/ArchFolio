import type { Metadata } from 'next';
import { PublicAgreement } from '@/components/agreement/PublicAgreement';
import '@/components/agreement/agreement.css';
import '@/components/agreement/public.css';

export const metadata: Metadata = {
  title: 'Agreement',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer'
};

/** Public, passcode-free view of ONE agreement version. Data comes from the link itself (see lib/sharing). */
export default async function AgreementTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicAgreement token={decodeURIComponent(token)} />;
}
