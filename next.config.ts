import type { NextConfig } from 'next';

/**
 * The public portfolio is the original static site, kept verbatim in /public.
 * The root URL is rewritten to it; the dashboard and the public agreement page
 * are App Router routes.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [{ source: '/', destination: '/index.html' }],
      afterFiles: [],
      fallback: []
    };
  },
  async headers() {
    // belt and braces: private areas are never indexed, even if robots.txt is ignored
    return [
      { source: '/dashboard/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      { source: '/agreement/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }
    ];
  }
};

export default nextConfig;
