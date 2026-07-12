import { Section } from '@/components/ui/section';
import { formatCompactNumber } from '@/lib/format';
import {
  presentTally,
  type ProposalDetailView,
  type TallyData,
  type TallyKind,
} from '@/lib/proposals/detail';
import { cn } from '@/lib/utils';

const BAR_FILL: Record<TallyKind, string> = {
  for: 'bg-vote-for',
  against: 'bg-vote-against',
  abstain: 'bg-ink-3',
};

/** Read an untyped-nullable numeric metadata field (the generator types it as `{}`). */
function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/**
 * Tally (§6.9): a stacked bar of the per-choice voting power, the breakdown, participation, the
 * leading outcome, and configured thresholds where the source carries them. The figures come from
 * the server-side aggregate (GET .../tally) — exact per-choice power + percentages in one request.
 * The 10s polling arrives in a follow-up; this renders the aggregate as loaded.
 */
export function TallySection({ tally, detail }: { tally: TallyData; detail: ProposalDetailView }) {
  const presented = presentTally(tally, detail.choices);
  const meta = detail.metadata;
  const supportRequiredPct =
    meta?.kind === 'aragon_voting' ? asNumber(meta.support_required_pct) : null;
  const minQuorumPct = meta?.kind === 'aragon_voting' ? asNumber(meta.min_accept_quorum_pct) : null;

  const forSeg = presented.segments.find((s) => s.kind === 'for');
  const againstSeg = presented.segments.find((s) => s.kind === 'against');
  const decisive = forSeg && againstSeg ? forSeg.power + againstSeg.power : null;
  const currentSupportPct =
    forSeg && decisive && decisive > 0 ? Math.round((forSeg.power / decisive) * 1000) / 10 : null;

  return (
    <Section
      number="05"
      title="Tally"
      reference={
        <span>
          {presented.source === 'choice_scores' ? 'per-choice scores' : 'summed from votes'}
        </span>
      }
    >
      {/* Stacked bar */}
      <div
        className="flex h-8 w-full overflow-hidden border border-line-2 bg-bg-3"
        role="img"
        aria-label={presented.segments.map((s) => `${s.label} ${s.pct}%`).join(', ')}
      >
        {presented.segments
          .filter((s) => s.pct > 0)
          .map((s) => (
            <div
              key={s.choiceIndex}
              className={cn('h-full', BAR_FILL[s.kind])}
              style={{ width: `${s.pct}%` }}
            />
          ))}
      </div>

      {/* Per-choice breakdown */}
      <ul className="flex flex-col gap-1.5 font-mono text-mono-body">
        {presented.segments.map((s) => (
          <li key={s.choiceIndex} className="flex items-center gap-3">
            <span className={cn('h-2.5 w-2.5 shrink-0', BAR_FILL[s.kind])} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-ink">{s.label}</span>
            <span className="tabular-nums text-ink-2">{s.pct.toFixed(1)}%</span>
            <span className="w-28 text-right tabular-nums text-ink-3">
              {formatCompactNumber(s.power)}
            </span>
          </li>
        ))}
      </ul>

      {/* Stats */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line-3 pt-4 font-mono text-caption sm:grid-cols-4">
        <Stat label="Voters" value={formatCompactNumber(presented.totalVoters)} />
        <Stat label="VP participating" value={formatCompactNumber(presented.totalPower)} />
        <Stat label="Outcome (current)" value={presented.leading ? presented.leading.label : '—'} />
        <Stat
          label="Current support"
          value={currentSupportPct != null ? `${currentSupportPct}%` : '—'}
        />
        {supportRequiredPct != null && (
          <Stat label="Support required" value={`${supportRequiredPct}%`} />
        )}
        {minQuorumPct != null && <Stat label="Min. quorum" value={`${minQuorumPct}%`} />}
      </dl>
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="uppercase tracking-[0.04em] text-ink-4">{label}</dt>
      <dd className="text-body text-ink">{value}</dd>
    </div>
  );
}
