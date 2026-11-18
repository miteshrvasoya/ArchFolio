import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/dashboard/Shell';
import './dashboard.css';

export const metadata: Metadata = {
  title: { default: 'Dashboard — .PLN architects', template: '%s — Dashboard' },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } }
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
