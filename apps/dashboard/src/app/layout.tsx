import './global.css';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';

// Fonts self-hosted at build via next/font; exposed as CSS vars that tokens.css
// references (--font-sans / --font-mono). See ADR-077 §1.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

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
    // suppressHydrationWarning: next-themes writes data-theme before hydration.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="light"
          enableSystem={false}
          storageKey="kv:theme"
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
