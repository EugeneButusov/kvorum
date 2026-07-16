'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { StackedArea } from '@/components/charts/stacked-area';
import { TimeSeries } from '@/components/charts/time-series';
import { Section } from '@/components/ui/section';
import {
  fetchConcentration,
  rangeFrom,
  type ConcentrationView,
  type TimeRange,
} from '@/lib/analytics/health';
import { browserApi } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const RANGES: { value: TimeRange; label: string }[] = [
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
  { value: 'all', label: 'All time' },
];

/**
 * Concentration (§6.7 §1): a Gini line + a stacked top-1/5/10/20 share area over time, current values
 * and the 90-day delta, with a time-range selector. Range changes refetch (no polling — §6.7).
 */
export function ConcentrationSection({
  slug,
  initial,
}: {
  slug: string;
  initial: ConcentrationView;
}) {
  const [range, setRange] = useState<TimeRange>('1y');
  const q = useQuery({
    queryKey: ['concentration', slug, range],
    queryFn: () => fetchConcentration(browserApi, slug, { from: rangeFrom(range, Date.now()) }),
    initialData: range === '1y' ? initial : undefined,
  });
  const view = q.data ?? initial;

  return (
    <Section
      number="01"
      title="Voting-power concentration"
      reference={
        <div className="flex gap-1.5 font-mono text-caption">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRange(r.value)}
              aria-pressed={range === r.value}
              className={cn(
                'border px-2 py-0.5 uppercase tracking-[0.04em] transition-colors',
                range === r.value
                  ? 'border-primary bg-primary text-bg-2'
                  : 'border-line-3 text-ink-2 hover:border-ink-3',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      {view.current && (
        <dl className="flex flex-wrap gap-x-10 gap-y-2 font-mono text-caption">
          <Stat label="Gini" value={view.current.gini.toFixed(2)} />
          <Stat label="Top-10 share" value={`${view.current.top10Pct.toFixed(1)}%`} />
          <Stat
            label="Top-10 · 90d"
            value={view.delta90Top10 == null ? '—' : formatDelta(view.delta90Top10)}
          />
        </dl>
      )}

      {view.buckets.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">No concentration data for this range.</p>
      ) : (
        <div className="flex flex-col gap-8">
          <TimeSeries
            title="Gini coefficient"
            buckets={view.buckets}
            series={[{ label: 'Gini', values: view.gini }]}
            formatValue={(v) => v.toFixed(2)}
            caption="0 = perfectly equal, 1 = one holder controls all voting power."
          />
          <StackedArea
            title="Top-holder share"
            buckets={view.buckets}
            series={view.bands}
            formatValue={(v) => `${v.toFixed(0)}%`}
            caption="Share of voting power held by the top 1 / 5 / 10 / 20 delegates."
          />
        </div>
      )}
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="uppercase tracking-[0.04em] text-ink-4">{label}</dt>
      <dd className="text-body-lg tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function formatDelta(pp: number): string {
  const sign = pp > 0 ? '+' : '';
  return `${sign}${pp.toFixed(1)}pp`;
}
