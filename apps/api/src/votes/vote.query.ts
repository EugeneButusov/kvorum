import { z } from 'zod';
import type { EndpointQuery } from '../query/query-descriptor';

export const VOTE_QUERY: EndpointQuery = {
  filters: {
    voter: {
      zod: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      column: 'vote.voter_actor_id',
      op: 'eq',
    },
    primary_choice: {
      zod: z.coerce.number().int().min(0).max(2),
      column: 'vote.primary_choice',
      op: 'in',
      multi: true,
    },
  },
  sortable: {
    cast_at: { column: 'vote.cast_at', kind: 'time' },
    voting_power_reported: { column: 'vote.voting_power_reported', kind: 'numeric' },
  },
  defaultSort: [{ field: 'cast_at', dir: 'desc' }],
  tiebreakColumn: 'vote.id',
};
