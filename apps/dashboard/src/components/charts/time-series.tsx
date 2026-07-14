import { seriesColor } from './chart-colors';
import type { ChartTableModel } from './data-table';
import { Figure, type ChartLegendItem } from './figure';
import { bandCenters, extent, linear } from './scale';

export type Series = { label: string; values: number[] };
export type TimeSeriesProps = {
  title: string;
  /** X-axis bucket labels (time buckets). */
  buckets: string[];
  series: Series[];
  /** Format a y value for the axis + table. */
  formatValue?: (v: number) => string;
  caption?: string;
};

const W = 640;
const H = 240;
const M = { top: 12, right: 16, bottom: 26, left: 48 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const TICKS = 4;

/** Multi-series line chart over time (ADR-085). One y-axis; recessive grid; identity via legend. */
export function TimeSeries({
  title,
  buckets,
  series,
  formatValue = (v) => String(v),
  caption,
}: TimeSeriesProps) {
  const all = series.flatMap((s) => s.values);
  const [y0, y1] = extent(all, { includeZero: true });
  const y = linear([y0, y1], [M.top + PLOT_H, M.top]);
  const xs = bandCenters(buckets.length, [M.left, M.left + PLOT_W]);
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => y0 + ((y1 - y0) * i) / TICKS);

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
        {/* gridlines + y labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={M.left}
              x2={M.left + PLOT_W}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--line-3)"
              strokeWidth={1}
            />
            <text
              x={M.left - 6}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--ink-3)"
              fontSize={10}
            >
              {formatValue(t)}
            </text>
          </g>
        ))}
        {/* x labels (first / mid / last to avoid crowding) */}
        {buckets.map((b, i) =>
          i === 0 || i === buckets.length - 1 || i === Math.floor(buckets.length / 2) ? (
            <text key={b} x={xs[i]} y={H - 8} textAnchor="middle" fill="var(--ink-3)" fontSize={10}>
              {b}
            </text>
          ) : null,
        )}
        {/* series lines */}
        {series.map((s, i) => (
          <polyline
            key={s.label}
            points={s.values.map((v, j) => `${xs[j]?.toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={seriesColor(i)}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
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
    ],
    rows: buckets.map((b, i) => {
      const row: Record<string, string | number> = { bucket: b };
      for (const s of series) row[s.label] = format(s.values[i] ?? 0);
      return row;
    }),
  };
}
