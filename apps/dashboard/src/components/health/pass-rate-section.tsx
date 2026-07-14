import { TimeSeries } from '@/components/charts/time-series';
import type { PassRateView } from '@/lib/analytics/health';
import { sourceLabel } from '@/lib/proposals/source';

/** Proposal pipeline / pass rate (§6.7 §4): pass rate by source type over time + the overall rate. */
export function PassRateSection({ view }: { view: PassRateView }) {
  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-h3 font-semibold text-ink">Proposal pipeline</h2>
        {view.overallPct != null && (
          <span className="font-mono text-caption text-ink-3">
            Overall pass rate {view.overallPct}%
          </span>
        )}
      </header>

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
    </section>
  );
}
