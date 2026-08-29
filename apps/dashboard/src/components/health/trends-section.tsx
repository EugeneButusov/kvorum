import { SparklineCard } from './sparkline-card';
import { Section } from '@/components/ui/section';
import type { PassRateView } from '@/lib/analytics/health';

export function TrendsSection({ passRate }: { passRate: PassRateView }) {
  const buckets = passRate.buckets;
  const dateRange = buckets.length >= 2 ? `${buckets[0]} → ${buckets[buckets.length - 1]}` : '—';

  return (
    <Section
      number="02"
      title="Trends · 90 days"
      reference={<span>daily samples · weekend gaps preserved</span>}
    >
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        <SparklineCard
          label="Participation rate"
          source="% VP that voted"
          dateRange={dateRange}
          currentValue="—"
          comingSoon
        />
        <SparklineCard
          label="Pass rate"
          source="passed / total"
          dateRange={dateRange}
          currentValue={passRate.overallPct != null ? `${passRate.overallPct}%` : '—'}
          values={passRate.sparklineValues}
        />
        <SparklineCard
          label="Forum activity"
          source="posts / week"
          dateRange={dateRange}
          currentValue="—"
          comingSoon
        />
      </div>
    </Section>
  );
}
