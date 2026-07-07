import './global.css';
import type { Metadata } from 'next';

// Icons (icon.svg, apple-icon.png) and the OG image (opengraph-image.png) are
// wired automatically via Next's metadata-file convention in this directory.
export const metadata: Metadata = {
  metadataBase: new URL('https://kvorum.watch'),
  title: {
    default: 'Kvorum',
    template: '%s · Kvorum',
  },
  description: 'On-chain governance, made legible.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
