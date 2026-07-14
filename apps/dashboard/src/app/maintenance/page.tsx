import type { Metadata } from 'next';

import { SystemPage } from '@/components/system/system-page';
import { SystemShell } from '@/components/system/system-shell';
import { STATUS_URL } from '@/lib/site';

export const metadata: Metadata = { title: 'Scheduled maintenance' };

// Shown site-wide during planned downtime — the proxy rewrites every route here and stamps the 503
// + Retry-After (§6.15). MAINTENANCE_UNTIL (ISO) drives the "back by" copy when set.
export default function MaintenancePage() {
  const until = process.env.MAINTENANCE_UNTIL;
  const backBy = until ? formatUntil(until) : null;

  return (
    <SystemShell>
      <SystemPage
        code="Maintenance"
        title="Kvorum is down for maintenance"
        showSearch={false}
        actions={[{ label: 'Status page ↗', href: STATUS_URL }]}
      >
        Kvorum is temporarily offline for scheduled maintenance.
        {backBy ? ` We expect to be back by ${backBy}.` : ' Please check back shortly.'}
      </SystemPage>
    </SystemShell>
  );
}

function formatUntil(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
}
