'use client';

import { Section } from '@/components/ui/section';
import { formatCompactNumber } from '@/lib/format';
import {
  deriveTally,
  type ProposalDetailView,
  type TallyKind,
  type VoteView,
} from '@/lib/proposals/detail';
import { cn } from '@/lib/utils';

const BAR_FILL: Record<TallyKind, string> = {
  for: 'bg-vote-for',
  against: 'bg-vote-against',
  abstain: 'bg-ink-3',
};

const DOT_FILL: Record<TallyKind, string> = {
  for: 'bg-vote-for',
  against: 'bg-vote-against',
  abstain: 'bg-ink-3',
};

/** Read an untyped-nullable numeric metadata field (the generator types it as `{}`). */
function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/**
 * Tally (§6.9): a stacked bar of the per-choice voting power, the numeric breakdown, participation,
 * the leading outcome, and configured thresholds where the source carries them. The figures are
 * derived client-side — Snapshot approval/weighted from `choice_scores`, everything else summed
 * from the votes (BigInt, so UInt256 power stays exact). The 10s polling arrives in a follow-up.
 */
export function TallySection({
  detail,
  votes,
  partial,
}: {
  detail: ProposalDetailView;
  votes: VoteView[];
  partial: boolean;
}) {
  const tally = deriveTally(detail, votes, { partial });
  const meta = detail.metadata;
  const supportRequiredPct =
    meta?.kind === 'aragon_voting' ? asNumber(meta.support_required_pct) : null;
  const minQuorumPct = meta?.kind === 'aragon_voting' ? asNumber(meta.min_accept_quorum_pct) : null;

  const forSeg = tally.segments.find((s) => s.kind === 'for');
  const againstSeg = tally.segments.find((s) => s.kind === 'against');
  const decisive = forSeg && againstSeg ? forSeg.power + againstSeg.power : null;
  const currentSupportPct =
    forSeg && decisive && decisive > 0 ? Math.round((forSeg.power / decisive) * 1000) / 10 : null;

  return (
    <Section
      number="05"
      title="Tally"
      reference={
        <span
          title={
            tally.source === 'choice_scores' ? 'Snapshot per-choice scores' : 'Summed from votes'
          }
        >
          {tally.source === 'choice_scores' ? 'per-choice scores' : 'summed from votes'}
        </span>
      }
    >
      {partial && (
        <p className="border border-note bg-note-bg px-3 py-2 font-mono text-caption text-note-ink">
          Showing the top {formatCompactNumber(votes.length)} voters by power — the totals below are
          a lower bound.
        </p>
      )}

      {/* Stacked bar */}
      <div
        className="flex h-8 w-full overflow-hidden border border-line-2 bg-bg-3"
        role="img"
        aria-label={tally.segments.map((s) => `${s.label} ${s.pct}%`).join(', ')}
      >
        {tally.segments
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
        {tally.segments.map((s) => (
          <li key={s.choiceIndex} className="flex items-center gap-3">
            <span className={cn('h-2.5 w-2.5 shrink-0', DOT_FILL[s.kind])} aria-hidden />
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
        <Stat
          label="Voters"
          value={tally.voterCount != null ? formatCompactNumber(tally.voterCount) : '—'}
        />
        <Stat label="VP participating" value={formatCompactNumber(tally.totalPower)} />
        <Stat label="Outcome (current)" value={tally.leading ? tally.leading.label : '—'} />
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
