'use client';

import { stateToVariant } from './state';
import { Freshness } from '@/components/ui/freshness';
import { Section } from '@/components/ui/section';
import { formatCompactNumber } from '@/lib/format';
import {
  presentTally,
  type ProposalDetailView,
  type TallyData,
  type TallyKind,
} from '@/lib/proposals/detail';
import { useTally } from '@/lib/proposals/use-tally';
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
 * Tally (§6.9 / §6.16): a stacked bar of the per-choice voting power, the breakdown, participation,
 * the leading outcome, and configured thresholds. Figures come from the server-side aggregate; while
 * the proposal is `active` it polls every 10s (backing off with quota, ADR-035), updating in place
 * with an honest freshness indicator. `tally` is the SSR seed.
 */
export function TallySection({ tally, detail }: { tally: TallyData; detail: ProposalDetailView }) {
  const active = stateToVariant(detail.state) === 'active';
  const live = useTally(
    { slug: detail.daoSlug, source_type: detail.sourceType, source_id: detail.sourceId },
    { active, initialTally: tally },
  );

  const presented = presentTally(live.tally, detail.choices);
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
        <Freshness
          active={active}
          updatedAt={live.updatedAt}
          isError={live.isError}
          isPaused={live.isPaused}
        />
      }
    >
      <p className="-mt-1 font-mono text-caption text-ink-4">
        {presented.source === 'choice_scores' ? 'Per-choice scores' : 'Summed from votes'}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        {/* Per-choice bars. The whole group is one img for AT — the individual bars are decorative. */}
        <div
          role="img"
          aria-label={presented.segments.map((s) => `${s.label} ${s.pct}%`).join(', ')}
          className="flex flex-col gap-3"
        >
          {presented.segments.map((s) => (
            <div
              key={s.choiceIndex}
              className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3"
            >
              <span className="truncate font-mono text-pill uppercase tracking-[0.06em] text-ink-2">
                {s.label}
              </span>
              <span className="relative h-5 overflow-hidden border border-line-3 bg-bg-3">
                <span
                  className={cn('absolute inset-y-0 left-0', BAR_FILL[s.kind])}
                  style={{ width: `${s.pct}%` }}
                />
              </span>
              <span className="whitespace-nowrap text-right font-mono text-body tabular-nums">
                <span className="font-semibold text-ink">{s.pct.toFixed(1)}%</span>
                <span className="ml-2 text-mono-body text-ink-3">
                  {formatCompactNumber(s.power)}
                </span>
              </span>
            </div>
          ))}
        </div>

        {/* Stats box */}
        <dl className="border border-line-3 bg-bg-2">
          <Stat label="Voters" value={formatCompactNumber(presented.totalVoters)} />
          <Stat label="VP participating" value={formatCompactNumber(presented.totalPower)} />
          <Stat
            label="Outcome (current)"
            value={presented.leading ? presented.leading.label : '—'}
          />
          <Stat
            label="Current support"
            value={currentSupportPct != null ? `${currentSupportPct}%` : '—'}
          />
          {supportRequiredPct != null && (
            <Stat label="Support required" value={`${supportRequiredPct}%`} />
          )}
          {minQuorumPct != null && <Stat label="Min. quorum" value={`${minQuorumPct}%`} />}
        </dl>
      </div>
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-line-3 px-3.5 py-2.5 last:border-b-0">
      <span className="font-mono text-mono-body text-ink-3">{label}</span>
      <span className="font-mono text-dense tabular-nums text-ink">{value}</span>
    </div>
  );
}
