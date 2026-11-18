import type { ReactNode } from 'react';

/** Root layout for App Router routes (the portfolio itself is static HTML in /public). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
