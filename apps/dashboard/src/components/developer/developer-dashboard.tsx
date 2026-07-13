'use client';

import Link from 'next/link';

import { AccountSection } from './account-section';
import { ApiKeysSection } from './api-keys-section';
import { QuickLinksSection } from './quick-links-section';
import { RateLimitSection } from './rate-limit-section';
import { UsageSection } from './usage-section';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/lib/auth/use-session';

/**
 * The developer dashboard (§6.13) — the only authenticated section. Gated on the session cookie:
 * signed-out visitors get a sign-in prompt (the automatic redirect + route protection lands in the
 * session-UX task). The whole surface is client-rendered since every section is session-scoped.
 */
export function DeveloperDashboard() {
  const { data: session, isLoading } = useSession();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 border border-line-2 bg-bg-2 px-6 py-12 text-center">
        <h2 className="font-mono text-lead font-semibold text-ink">Sign in to continue</h2>
        <p className="text-small text-ink-3">
          The developer dashboard is the only part of Kvorum that needs an account. Sign in with
          your wallet to manage API keys.
        </p>
        <Button asChild>
          <Link href="/login?next=/developer">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <ApiKeysSection />
      <UsageSection />
      <RateLimitSection />
      <QuickLinksSection />
      <AccountSection />
    </div>
  );
}
