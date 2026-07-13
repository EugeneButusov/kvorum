import Link from 'next/link';

import { Logo } from '@/components/brand/Logo';

/**
 * Minimal gateway layout for the auth pages (§6.14) — no shell chrome. A centered card over the
 * page background; the logo links back to the public dashboard.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-bg px-4 py-12">
      <Link href="/" className="flex items-center gap-2.5">
        <Logo size={26} />
        <span className="font-mono text-body-lg font-bold tracking-[0.04em]">KVORUM</span>
      </Link>
      <main className="w-full max-w-md border border-line-2 bg-bg-2 p-6 sm:p-8">{children}</main>
    </div>
  );
}
