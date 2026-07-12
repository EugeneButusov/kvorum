'use client';

// Interim chart gallery: renders every chart primitive against sample data so the library can be
// eyeballed in light and dark. Not a product route.
import { DelegationFlow } from '@/components/charts/delegation-flow';
import { Heatmap } from '@/components/charts/heatmap';
import { Sparkline } from '@/components/charts/sparkline';
import { StackedArea } from '@/components/charts/stacked-area';
import { TimeSeries } from '@/components/charts/time-series';
import { ThemeToggle } from '@/components/theme-toggle';

const BUCKETS = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];

export default function ChartsGallery() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-12 p-10">
      <header className="flex items-center justify-between">
        <h1 className="font-mono text-h2 font-semibold">Charts</h1>
        <ThemeToggle />
      </header>

      <TimeSeries
        title="Participation rate"
        buckets={BUCKETS}
        series={[
          { label: 'Compound', values: [38, 41, 44, 40, 47, 52] },
          { label: 'Uniswap', values: [22, 28, 25, 31, 29, 34] },
        ]}
        formatValue={(v) => `${v}%`}
        caption="Share of eligible voting power participating, by month."
      />

      <StackedArea
        title="Votes by choice"
        buckets={BUCKETS}
        series={[
          { label: 'For', values: [120, 140, 160, 150, 190, 210] },
          { label: 'Against', values: [40, 60, 50, 70, 55, 48] },
          { label: 'Abstain', values: [10, 12, 8, 20, 15, 18] },
        ]}
      />

      <div className="flex items-center gap-4 font-mono text-mono-body">
        <span>Inline sparkline:</span>
        <Sparkline values={[3, 5, 4, 8, 6, 9, 7, 11]} label="trend, latest 11" />
      </div>

      <Heatmap
        title="Delegate alignment"
        rowLabels={['a16z', 'Gauntlet', 'Blck', 'Wintermute']}
        colLabels={['P-1', 'P-2', 'P-3', 'P-4', 'P-5']}
        cells={[
          [1, 0.8, 1, 0.4, null],
          [0.9, 1, 0.6, 1, 0.7],
          [0.3, 0.5, 1, 0.2, 1],
          [1, 1, 0.9, 0.8, 0.95],
        ]}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        caption="Vote agreement with the DAO outcome, per proposal."
      />

      <DelegationFlow
        title="Delegation flow"
        nodes={[
          { id: 'a', label: 'holder.eth' },
          { id: 'b', label: '0x1234…abcd' },
          { id: 'c', label: 'treasury.eth' },
          { id: 'x', label: 'Gauntlet' },
          { id: 'y', label: 'a16z' },
        ]}
        edges={[
          { from: 'a', to: 'x', weight: 120000 },
          { from: 'b', to: 'x', weight: 40000 },
          { from: 'c', to: 'y', weight: 200000 },
          { from: 'a', to: 'y', weight: 15000 },
        ]}
        formatWeight={(w) => `${(w / 1000).toFixed(0)}k`}
      />
    </main>
  );
}
