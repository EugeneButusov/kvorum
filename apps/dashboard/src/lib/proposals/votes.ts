// Fetch the full vote set for a proposal, paging the votes endpoint (max 200/page) until it is
// exhausted or the cap is hit. Sorted by power descending, so a capped set still holds the most
// significant voters and the derived tally is an honest lower bound (surfaced via `partial`).

import { normalizeVote, type VoteView } from './detail';
import type { createApiClient } from '@/lib/api/client';

export type ProposalPath = { slug: string; source_type: string; source_id: string };

const PAGE_LIMIT = 200;
const MAX_PAGES = 25; // 5,000 votes — well past any live proposal's turnout.

export async function fetchAllVotes(
  api: ReturnType<typeof createApiClient>,
  path: ProposalPath,
  { maxPages = MAX_PAGES }: { maxPages?: number } = {},
): Promise<{ votes: VoteView[]; partial: boolean }> {
  const votes: VoteView[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const { data, error } = await api.GET(
      '/v1/daos/{slug}/proposals/{source_type}/{source_id}/votes',
      {
        params: {
          path,
          query: {
            limit: PAGE_LIMIT,
            sort: '-voting_power_reported',
            ...(cursor ? { cursor } : {}),
          },
        },
      },
    );
    if (error) throw error;

    for (const item of data.data) votes.push(normalizeVote(item));

    // next_cursor is an opaque string at runtime (the generator mistypes untyped-nullable as `{}`).
    const next = data.pagination.next_cursor as string | null;
    if (!data.pagination.has_more || !next) {
      return { votes, partial: false };
    }
    cursor = next;
  }

  return { votes, partial: true };
}
