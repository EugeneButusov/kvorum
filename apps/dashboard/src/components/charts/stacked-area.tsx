import { seriesColor } from './chart-colors';
import type { ChartTableModel } from './data-table';
import { Figure, type ChartLegendItem } from './figure';
import { bandCenters, linear } from './scale';
import type { Series } from './time-series';

export type StackedAreaProps = {
  title: string;
  buckets: string[];
  series: Series[];
  formatValue?: (v: number) => string;
  caption?: string;
};

const W = 640;
const H = 240;
const M = { top: 12, right: 16, bottom: 26, left: 48 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

/** Stacked-area chart over time (ADR-085): part-to-whole across buckets. One y-axis; 2px surface gap. */
export function StackedArea({
  title,
  buckets,
  series,
  formatValue = (v) => String(v),
  caption,
}: StackedAreaProps) {
  const totals = buckets.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const yMax = Math.max(1, ...totals);
  const y = linear([0, yMax], [M.top + PLOT_H, M.top]);
  const xs = bandCenters(buckets.length, [M.left, M.left + PLOT_W]);

  // Cumulative baselines so each series sits on top of the ones below it.
  const baselines = buckets.map(() => 0);
  const bands = series.map((s) =>
    s.values.map((v, i) => {
      const bottom = baselines[i]!;
      baselines[i] = bottom + (v ?? 0);
      return { bottom, top: baselines[i]! };
    }),
  );

  const legend: ChartLegendItem[] = series.map((s, i) => ({
    label: s.label,
    color: seriesColor(i),
  }));

  return (
    <Figure
      title={title}
      table={toTable(buckets, series, formatValue)}
      legend={legend}
      caption={caption}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="font-mono" preserveAspectRatio="none">
        {series.map((s, si) => {
          const band = bands[si]!;
          const top = band.map((b, i) => `${xs[i]?.toFixed(1)},${y(b.top).toFixed(1)}`);
          const bottom = band
            .map((b, i) => `${xs[i]?.toFixed(1)},${y(b.bottom).toFixed(1)}`)
            .reverse();
          return (
            <polygon
              key={s.label}
              points={[...top, ...bottom].join(' ')}
              fill={seriesColor(si)}
              stroke="var(--bg-2)"
              strokeWidth={2}
            />
          );
        })}
        {/* x labels */}
        {buckets.map((b, i) =>
          i === 0 || i === buckets.length - 1 || i === Math.floor(buckets.length / 2) ? (
            <text key={b} x={xs[i]} y={H - 8} textAnchor="middle" fill="var(--ink-3)" fontSize={10}>
              {b}
            </text>
          ) : null,
        )}
      </svg>
    </Figure>
  );
}

function toTable(
  buckets: string[],
  series: Series[],
  format: (v: number) => string,
): ChartTableModel {
  return {
    columns: [
      { key: 'bucket', label: 'Period' },
      ...series.map((s) => ({ key: s.label, label: s.label, numeric: true })),
      { key: '__total', label: 'Total', numeric: true },
    ],
    rows: buckets.map((b, i) => {
      const row: Record<string, string | number> = { bucket: b };
      let total = 0;
      for (const s of series) {
        const v = s.values[i] ?? 0;
        row[s.label] = format(v);
        total += v;
      }
      row.__total = format(total);
      return row;
    }),
  };
}
