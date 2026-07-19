import Link from 'next/link';

import { daoVariant, stateToVariant } from './state';
import { TallySummary } from './tally-summary';
import { Pill } from '@/components/ui/pill';
import { StatePill } from '@/components/ui/state-pill';
import { formatDeadline, truncateAddress } from '@/lib/format';
import type { ProposalListItemView } from '@/lib/proposals/list';
import { sourceLabel } from '@/lib/proposals/source';

/**
 * One proposal as a card, for the phone-width proposals list — the reference's `.m-card`. The desktop
 * table carries the same six fields across columns; at 390px those columns cannot fit, so the card
 * stacks them instead: pills and the deadline on one line, then the id + title, the proposer/source
 * meta, and the tally. Nothing is dropped, so the two layouts stay informationally equal.
 */
export function ProposalCard({ item, showDao }: { item: ProposalListItemView; showDao: boolean }) {
  const deadline = formatDeadline(item.votingEndsAt);
  const live = item.state === 'active';
  const idLabel = /^\d+$/.test(item.sourceId) ? `#${item.sourceId}` : item.sourceId;
  const proposerName = item.proposer.displayName ?? truncateAddress(item.proposer.address);

  return (
    <Link
      href={item.href}
      className="flex flex-col gap-2.5 border border-line-2 bg-bg-2 p-3 transition-colors hover:bg-bg-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {showDao && <Pill dao={daoVariant(item.daoSlug)}>{item.daoSlug}</Pill>}
          <StatePill state={stateToVariant(item.state)}>{item.state}</StatePill>
        </div>
        {deadline && (
          <span
            className={`shrink-0 font-mono text-micro uppercase tracking-[0.06em] ${
              live ? 'text-primary' : 'text-ink-3'
            }`}
            suppressHydrationWarning
          >
            {deadline}
          </span>
        )}
      </div>

      <h3 className="text-body-lg font-medium leading-snug text-ink">
        <span className="mr-1 font-mono text-ink-3">{idLabel}</span>
        {item.title ?? `Proposal #${item.sourceId}`}
      </h3>

      <div className="font-mono text-micro text-ink-3">
        proposer {proposerName} · {sourceLabel(item.sourceType)}
        {!item.binding && ' · signaling'}
      </div>

      {item.tally.length > 0 && <TallySummary bars={item.tally} fluid />}
    </Link>
  );
}
