import Link from 'next/link';

import { daoVariant, stateToVariant } from '@/components/proposal/state';
import { Pill } from '@/components/ui/pill';
import { StatePill } from '@/components/ui/state-pill';
import { formatDeadline } from '@/lib/format';
import type { ProposalListItemView } from '@/lib/proposals/list';
import { sourceLabel } from '@/lib/proposals/source';

/**
 * A horizontal active-proposal card (§6.4 §2). Tally bar + mismatch + AI TL;DR (in the mock) need
 * a per-proposal aggregate / M5 and are omitted for now — this shows the indexed facts.
 */
export function ProposalCard({ item }: { item: ProposalListItemView }) {
  const deadline = formatDeadline(item.votingEndsAt);

  return (
    <Link
      href={item.href}
      className="flex w-72 shrink-0 flex-col gap-3 border border-line-2 bg-bg-2 p-4 transition-colors hover:border-ink-3"
    >
      <div className="flex flex-wrap items-center gap-2 font-mono text-caption">
        <Pill dao={daoVariant(item.daoSlug)}>{item.daoSlug}</Pill>
        <StatePill state={stateToVariant(item.state)}>{item.state}</StatePill>
      </div>
      <h3 className="line-clamp-3 flex-1 text-body-lg font-medium text-ink">
        {item.title ?? `Proposal #${item.sourceId}`}
      </h3>
      <div className="flex items-center justify-between font-mono text-caption text-ink-3">
        <span className="text-ink-4">{sourceLabel(item.sourceType)}</span>
        {deadline && <span suppressHydrationWarning>{deadline}</span>}
      </div>
    </Link>
  );
}
