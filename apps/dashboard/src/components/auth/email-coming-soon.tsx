import Link from 'next/link';

import { Banner } from '@/components/ui/banner';

/**
 * Placeholder for the password-recovery pages (§6.14 /forgot-password, /reset-password). The email
 * auth path is a documented fast-follow (Resend, ADR-083); until it lands these render the honest
 * "coming soon" state and point wallet users at SIWE, which has no password to recover.
 */
export function EmailComingSoon({ heading }: { heading: string }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-mono text-lead font-semibold text-ink">{heading}</h1>
      <Banner severity="note" glyph="i">
        Email accounts are coming soon. For now, Kvorum supports Sign-In With Ethereum only — a
        wallet identity has no password to reset.
      </Banner>
      <p className="text-small text-ink-3">
        Sign in with your wallet from the{' '}
        <Link href="/login" className="text-primary hover:underline">
          sign-in page
        </Link>
        .
      </p>
    </div>
  );
}
