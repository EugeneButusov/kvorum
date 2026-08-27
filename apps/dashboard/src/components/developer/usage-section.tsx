'use client';

import { TimeSeries, type Series } from '@/components/charts/time-series';
import { Section } from '@/components/ui/section';
import { Skeleton } from '@/components/ui/skeleton';
import { useUsage } from '@/lib/developer/use-usage';
import { formatCompactNumber } from '@/lib/format';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function formatBucket(iso: string): string {
  return dateFormatter.format(new Date(iso + 'T00:00:00Z'));
}

export function UsageSection() {
  const { data, isLoading } = useUsage();

  if (isLoading) {
    return (
      <Section number="2" title="Usage">
        <Skeleton className="h-[200px] w-full" />
      </Section>
    );
  }

  if (!data || data.keys.length === 0) {
    return (
      <Section number="2" title="Usage">
        <div className="border border-dashed border-line-2 px-4 py-8 text-center text-small text-ink-3">
          No API keys found. Create a key above to start tracking usage.
        </div>
      </Section>
    );
  }

  const hasAnyUsage = data.keys.some((k) => k.daily.some((v) => v > 0));

  if (!hasAnyUsage) {
    return (
      <Section number="2" title="Usage">
        <div className="border border-dashed border-line-2 px-4 py-8 text-center text-small text-ink-3">
          No API requests recorded yet. Usage data will appear here once your keys are in use.
        </div>
      </Section>
    );
  }

  const buckets = data.buckets.map(formatBucket);
  const series: Series[] = data.keys
    .filter((k) => k.daily.some((v) => v > 0))
    .map((k) => ({
      label: k.label ?? `${k.prefix}...${k.last_four}`,
      values: k.daily,
    }));

  const total = data.keys.reduce((sum, k) => sum + k.daily.reduce((a, b) => a + b, 0), 0);

  return (
    <Section number="2" title="Usage" reference={`${formatCompactNumber(total)} requests / 30d`}>
      <TimeSeries
        title="Daily requests"
        buckets={buckets}
        series={series}
        formatValue={formatCompactNumber}
        heightPx={200}
      />
    </Section>
  );
}
