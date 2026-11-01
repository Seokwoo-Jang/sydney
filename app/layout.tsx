import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { S } from '@/lib/strings';
import '../styles/fonts.css';
import '../styles/tokens.css';
import './globals.css';

// Server component: read the basePath directly (lib/url is client-side).
const asset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${path}`;

export const metadata: Metadata = {
  title: S.brand.title,
  description: S.brand.description,
  robots: { index: false, follow: false },
  // Home-screen app (plan §11.3). Paths carry the basePath (/sydney).
  manifest: asset('/manifest.webmanifest'),
  icons: { icon: asset('/icons/favicon-32.png'), apple: asset('/icons/apple-touch-icon.png') },
  appleWebApp: { capable: true, title: 'Side by Side', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#172F3B',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
