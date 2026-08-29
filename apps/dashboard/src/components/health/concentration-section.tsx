import { LorenzHistogram } from '@/components/charts/lorenz-histogram';
import { Section } from '@/components/ui/section';
import type { ConcentrationView, LorenzBar } from '@/lib/analytics/health';
import type { DelegateLeaderboardEntry } from '@/lib/daos/delegates';
import { formatCompactNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export function ConcentrationSection({
  delegates,
  concentration,
  lorenzBars,
}: {
  delegates: DelegateLeaderboardEntry[];
  concentration: ConcentrationView;
  lorenzBars: LorenzBar[];
}) {
  const top10Pct = concentration.current?.top10Pct;
  const gini = concentration.current?.gini ?? 0;
  const topQuintileBars = lorenzBars.filter((b) => b.isTopQuintile);
  const topQuintilePct =
    topQuintileBars.length > 0 ? topQuintileBars[topQuintileBars.length - 1]!.cumulativePct : 0;

  return (
    <Section
      number="03"
      title="Voting power concentration"
      reference={top10Pct != null ? <span>{top10Pct.toFixed(1)}% in top 10</span> : undefined}
    >
      {delegates.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">No delegate data available.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <Top10Table delegates={delegates} top10Pct={top10Pct} />
          <LorenzHistogram
            title="Lorenz curve"
            bars={lorenzBars}
            gini={gini}
            topQuintilePct={topQuintilePct}
            delta90Pp={concentration.delta90Top10}
            caption="Cumulative share by delegate rank."
          />
        </div>
      )}
    </Section>
  );
}

function Top10Table({
  delegates,
  top10Pct,
}: {
  delegates: DelegateLeaderboardEntry[];
  top10Pct: number | null | undefined;
}) {
  const maxVp = delegates[0]?.votingPower ?? 1;

  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-line-2 pb-2">
        <span className="font-mono text-body font-semibold uppercase tracking-[0.04em] text-ink">
          Top-10 holders
        </span>
        {top10Pct != null && (
          <span className="font-mono text-caption text-ink-3">{top10Pct.toFixed(1)}% of VP</span>
        )}
      </div>
      <table className="w-full text-body">
        <thead>
          <tr>
            <th className="w-8 border-b border-line-2 bg-bg px-3.5 py-2 text-left font-mono text-caption font-semibold uppercase tracking-[0.06em] text-ink-3">
              #
            </th>
            <th className="border-b border-line-2 bg-bg px-3.5 py-2 text-left font-mono text-caption font-semibold uppercase tracking-[0.06em] text-ink-3">
              Delegate
            </th>
            <th className="border-b border-line-2 bg-bg px-3.5 py-2 font-mono text-caption font-semibold uppercase tracking-[0.06em] text-ink-3" />
            <th className="border-b border-line-2 bg-bg px-3.5 py-2 text-right font-mono text-caption font-semibold uppercase tracking-[0.06em] text-ink-3">
              VP
            </th>
            <th className="w-[60px] border-b border-line-2 bg-bg px-3.5 py-2 text-right font-mono text-caption font-semibold uppercase tracking-[0.06em] text-ink-3">
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {delegates.map((d, i) => (
            <tr key={d.address}>
              <td className="border-b border-dashed border-line-3 px-3.5 py-2 font-mono text-ink-3">
                {d.rank}
              </td>
              <td className="border-b border-dashed border-line-3 px-3.5 py-2 font-mono text-small text-ink">
                {d.displayName ?? d.address.slice(0, 10)}
                <span className="block text-caption text-ink-3">
                  {d.address.slice(0, 6)}…{d.address.slice(-4)}
                </span>
              </td>
              <td className="w-[120px] border-b border-dashed border-line-3 px-3.5 py-2">
                <div className="relative h-1.5 w-full bg-bg-3">
                  <div
                    className={cn('absolute inset-y-0 left-0', i === 0 ? 'bg-warn' : 'bg-ink')}
                    style={{ width: `${Math.round((d.votingPower / maxVp) * 100)}%` }}
                  />
                </div>
              </td>
              <td className="border-b border-dashed border-line-3 px-3.5 py-2 text-right font-mono tabular-nums text-ink">
                {formatCompactNumber(d.votingPower)}
              </td>
              <td className="w-[60px] border-b border-dashed border-line-3 px-3.5 py-2 text-right font-mono tabular-nums text-ink-2">
                {d.sharePct.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
