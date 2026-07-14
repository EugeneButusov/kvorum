'use client';

import { useQuery } from '@tanstack/react-query';

import { Banner } from '@/components/ui/banner';
import { STATUS_URL } from '@/lib/site';
import { fetchDegradedStatus } from '@/lib/system/health';

/**
 * Site-wide degraded-mode banner (§6.15 503). Non-blocking: it sits above the page content, which
 * still loads normally with whatever data is available. Polls /health in the background; renders
 * nothing while healthy.
 */
export function DegradedBar() {
  const { data } = useQuery({
    queryKey: ['system', 'health'],
    queryFn: fetchDegradedStatus,
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: false,
  });

  if (!data) return null;

  return (
    <Banner
      severity="warn"
      glyph="!"
      className="border-x-0 border-t-0"
      role="status"
      action={
        <a href={STATUS_URL} className="whitespace-nowrap font-mono text-small underline">
          Status ↗
        </a>
      }
    >
      {data.reason}
    </Banner>
  );
}
