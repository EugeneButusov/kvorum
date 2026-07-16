import { TimeSeries } from '@/components/charts/time-series';
import { Section } from '@/components/ui/section';
import type { PassRateView } from '@/lib/analytics/health';
import { sourceLabel } from '@/lib/proposals/source';

/** Proposal pipeline / pass rate (§6.7 §4): pass rate by source type over time + the overall rate. */
export function PassRateSection({ view }: { view: PassRateView }) {
  return (
    <Section
      number="04"
      title="Proposal pipeline"
      reference={
        view.overallPct != null ? <span>Overall pass rate {view.overallPct}%</span> : undefined
      }
    >
      {view.buckets.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">No resolved proposals yet.</p>
      ) : (
        <TimeSeries
          title="Pass rate by source"
          buckets={view.buckets}
          series={view.series.map((s) => ({ ...s, label: sourceLabel(s.label) }))}
          formatValue={(v) => `${v.toFixed(0)}%`}
          caption="Share of decided proposals that passed, by source type."
        />
      )}
    </Section>
  );
}
