import type { TallySummaryBar } from '@/lib/proposals/detail';
import type { TallyKind } from '@/lib/proposals/detail';
import { cn } from '@/lib/utils';

const BAR_FILL: Record<TallyKind, string> = {
  for: 'bg-vote-for',
  against: 'bg-vote-against',
  abstain: 'bg-vote-abstain',
};

const BAR_LABEL: Record<TallyKind, string> = {
  for: 'for',
  against: 'against',
  abstain: 'abstain',
};

/**
 * The per-row tally bars in the proposals table (§6.5), ported from the reference's `.tally`: a small
 * stacked list of for / against / abstain rows, each a label, a thin track with a coloured fill, and
 * the percentage. Figures are the server-computed shares; the whole group is one labelled image for AT.
 */
export function TallySummary({
  bars,
  fluid = false,
}: {
  bars: TallySummaryBar[];
  fluid?: boolean;
}) {
  if (bars.length === 0) return <span className="text-ink-4">—</span>;

  return (
    <div
      role="img"
      aria-label={bars.map((b) => `${BAR_LABEL[b.kind]} ${b.pct}%`).join(', ')}
      className={cn(
        'flex max-w-full flex-col gap-0.5',
        // The table column is a fixed 220px; the phone card lets the track use the full card width.
        fluid ? 'w-full' : 'w-[220px]',
      )}
    >
      {bars.map((bar) => (
        <div
          key={bar.kind}
          className="grid grid-cols-[52px_minmax(0,1fr)_36px] items-center gap-1.5 font-mono text-pill"
        >
          <span className="tracking-[0.04em] text-ink-3">{BAR_LABEL[bar.kind]}</span>
          <span className="relative h-[5px] bg-bg-3">
            <span
              className={cn('absolute inset-y-0 left-0', BAR_FILL[bar.kind])}
              style={{ width: `${Math.min(bar.pct, 100)}%` }}
            />
          </span>
          <span className="text-right tabular-nums text-ink">{Math.round(bar.pct)}%</span>
        </div>
      ))}
    </div>
  );
}
