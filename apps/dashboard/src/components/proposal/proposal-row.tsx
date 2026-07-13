import Link from 'next/link';

import { daoVariant, stateToVariant } from './state';
import { Pill } from '@/components/ui/pill';
import { StatePill } from '@/components/ui/state-pill';
import { formatDeadline } from '@/lib/format';
import type { ProposalListItemView } from '@/lib/proposals/list';
import { sourceLabel } from '@/lib/proposals/source';

/**
 * One proposal in a list (§6.5 / §6.8): DAO badge, two-line title, source, state, and the relative
 * voting-close time. Per-row tally + mismatch (in the mock) need data the list API doesn't carry —
 * they arrive with a batched tally endpoint / M5.
 */
export function ProposalRow({
  item,
  showDao = true,
}: {
  item: ProposalListItemView;
  showDao?: boolean;
}) {
  const deadline = formatDeadline(item.votingEndsAt);

  return (
    <Link
      href={item.href}
      className="flex flex-col gap-2 border-b border-line-3 py-4 transition-colors hover:bg-bg-3"
    >
      <div className="flex flex-wrap items-center gap-2 font-mono text-caption">
        {showDao && <Pill dao={daoVariant(item.daoSlug)}>{item.daoSlug}</Pill>}
        <StatePill state={stateToVariant(item.state)}>{item.state}</StatePill>
        <span className="text-ink-4">{sourceLabel(item.sourceType)}</span>
        {!item.binding && <span className="text-note-ink">signaling</span>}
        {deadline && (
          <span className="ml-auto text-ink-3" suppressHydrationWarning>
            {deadline}
          </span>
        )}
      </div>
      <h3 className="line-clamp-2 text-body-lg font-medium text-ink">
        {item.title ?? `Proposal #${item.sourceId}`}
      </h3>
    </Link>
  );
}
