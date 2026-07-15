'use client';

import { ProposalRow } from '@/components/proposal/proposal-row';
import { Freshness } from '@/components/ui/freshness';
import { Section } from '@/components/ui/section';
import type { ProposalListItemView } from '@/lib/proposals/list';
import { useProposalsFeed } from '@/lib/proposals/use-proposals-feed';

// A cross-DAO "news ticker" of governance. v1 has no unified events endpoint, so we surface the most
// recently-active proposals (state changes) as the activity feed; richer event types arrive later.
const QUERY = { sort: '-state_updated_at', limit: 15 };

/** Recent activity feed (§6.4 §5): most-recent governance activity, polled every 30s. */
export function ActivityFeed({ initialItems }: { initialItems: ProposalListItemView[] }) {
  const feed = useProposalsFeed('activity', QUERY, initialItems);

  return (
    <Section
      number="04"
      title="Recent activity"
      reference={
        <Freshness
          active
          updatedAt={feed.updatedAt}
          isError={feed.isError}
          isPaused={feed.isPaused}
        />
      }
    >
      {feed.items.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">No recent governance activity.</p>
      ) : (
        <ul>
          {feed.items.map((item) => (
            <li key={`${item.daoSlug}:${item.sourceType}:${item.sourceId}`}>
              <ProposalRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
