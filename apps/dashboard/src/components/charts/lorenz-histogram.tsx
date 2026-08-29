import type { ChartTableModel } from './data-table';
import { Figure } from './figure';
import type { LorenzBar } from '@/lib/analytics/health';

export function LorenzHistogram({
  title,
  bars,
  gini,
  topQuintilePct,
  delta90Pp,
  caption,
}: {
  title: string;
  bars: LorenzBar[];
  gini: number;
  topQuintilePct: number;
  delta90Pp: number | null;
  caption?: string;
}) {
  if (bars.length === 0) return null;

  const gap = 2;
  const barW = Math.max(1, (640 - gap * (bars.length - 1)) / bars.length);
  const chartH = 140;

  const table: ChartTableModel = {
    columns: [
      { key: 'rank', label: 'Rank bucket' },
      { key: 'pct', label: 'Cumulative VP %', numeric: true },
    ],
    rows: bars.map((b) => ({ rank: `Bucket ${b.rank}`, pct: `${b.cumulativePct}%` })),
  };

  return (
    <div>
      <Figure title={title} caption={caption} table={table}>
        <svg
          viewBox={`0 0 640 ${chartH}`}
          className="w-full"
          role="img"
          aria-label={`Lorenz histogram: Gini ${gini.toFixed(2)}`}
        >
          {bars.map((b, i) => {
            const h = (b.cumulativePct / 100) * chartH;
            return (
              <rect
                key={b.rank}
                x={i * (barW + gap)}
                y={chartH - h}
                width={barW}
                height={h}
                fill={b.isTopQuintile ? 'var(--warn)' : 'var(--ink)'}
              />
            );
          })}
        </svg>
      </Figure>
      <div className="mt-2.5 flex justify-between font-mono text-caption text-ink-3">
        <span>0%</span>
        <span>top quintile</span>
        <span>100%</span>
      </div>
      <div className="mt-3.5 border border-note bg-note-bg px-3 py-2.5 text-body text-note-ink">
        <b>Gini {gini.toFixed(2)}</b> · top quintile of delegates holds{' '}
        <b>{topQuintilePct.toFixed(0)}%</b> of VP.
        {delta90Pp != null && (
          <>
            {' '}
            Concentration {delta90Pp > 0 ? 'up' : 'down'} {Math.abs(delta90Pp).toFixed(1)}pp from
            prior 90 days.
          </>
        )}
      </div>
    </div>
  );
}
