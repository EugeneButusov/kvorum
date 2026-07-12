'use client';

import { ProposalCard } from './proposal-card';
import { Freshness } from '@/components/ui/freshness';
import type { ProposalListItemView } from '@/lib/proposals/list';
import { useProposalsFeed } from '@/lib/proposals/use-proposals-feed';

// Closest deadlines first (§6.4 §2).
const QUERY = { state: 'active', sort: 'voting_ends_at', limit: 12 };

/** Active proposals across all DAOs (§6.4 §2): a horizontal card scroller, polled every 30s. */
export function ActiveProposals({ initialItems }: { initialItems: ProposalListItemView[] }) {
  const feed = useProposalsFeed('active', QUERY, initialItems);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between border-b border-line-2 pb-2">
        <h2 className="text-h3 font-semibold text-ink">Active proposals</h2>
        <Freshness
          active
          updatedAt={feed.updatedAt}
          isError={feed.isError}
          isPaused={feed.isPaused}
        />
      </header>

      {feed.items.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">No proposals are currently active.</p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {feed.items.map((item) => (
            <ProposalCard key={`${item.daoSlug}:${item.sourceType}:${item.sourceId}`} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
