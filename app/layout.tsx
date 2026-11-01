import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { S } from '@/lib/strings';
import '../styles/fonts.css';
import '../styles/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: S.brand.title,
  description: S.brand.description,
  robots: { index: false, follow: false },
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
