// One page of a proposal's votes. The tally no longer rides on this (it has its own aggregate
// endpoint) — the voters table paginates through here 50 at a time, on demand.

import { normalizeVote, type VoteView } from './detail';
import type { createApiClient } from '@/lib/api/client';

export type ProposalPath = { slug: string; source_type: string; source_id: string };

export const VOTES_PAGE_SIZE = 50;

export type VotesSort = '-voting_power_reported' | 'voting_power_reported' | '-cast_at' | 'cast_at';

export type VotesPage = { votes: VoteView[]; nextCursor: string | null };

export type FetchVotesPageOptions = {
  sort?: VotesSort;
  cursor?: string;
  /** Filter to a single choice index (maps to the `primary_choice` filter). */
  primaryChoice?: number;
  limit?: number;
};

export async function fetchVotesPage(
  api: ReturnType<typeof createApiClient>,
  path: ProposalPath,
  options: FetchVotesPageOptions = {},
): Promise<VotesPage> {
  const query = {
    limit: options.limit ?? VOTES_PAGE_SIZE,
    sort: options.sort ?? '-voting_power_reported',
    ...(options.cursor ? { cursor: options.cursor } : {}),
    // The votes endpoint honours `primary_choice` (VOTE_QUERY), but the shared list-query DTO
    // doesn't declare it, so the generated type omits it — send it through untyped.
    ...(options.primaryChoice != null ? { primary_choice: String(options.primaryChoice) } : {}),
  };
  const { data, error } = await api.GET(
    '/v1/daos/{slug}/proposals/{source_type}/{source_id}/votes',
    { params: { path, query } },
  );
  if (error) throw error;

  // next_cursor is an opaque string at runtime (the generator mistypes untyped-nullable as `{}`).
  const nextCursor = (data.pagination.next_cursor as string | null) ?? null;
  return {
    votes: data.data.map(normalizeVote),
    nextCursor: data.pagination.has_more ? nextCursor : null,
  };
}
