'use client';

import { AccountSection } from './account-section';
import { ApiKeysSection } from './api-keys-section';
import { QuickLinksSection } from './quick-links-section';
import { RateLimitSection } from './rate-limit-section';
import { UsageSection } from './usage-section';
import { Skeleton } from '@/components/ui/skeleton';
import { useRequireSession } from '@/lib/auth/use-require-session';

/**
 * The developer dashboard (§6.13) — the only authenticated section. Protected by useRequireSession:
 * middleware turns away visitors with no session cookie, and this redirects the expired-cookie case
 * to login. While the session is resolving (or a redirect is in flight) we render a skeleton, so no
 * authenticated content flashes. The whole surface is client-rendered since every section is
 * session-scoped.
 */
export function DeveloperDashboard() {
  const { session } = useRequireSession();

  if (!session) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
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
