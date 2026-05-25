import { z } from 'zod';
import type { EndpointQuery } from '../query/query-descriptor';

export const ACTOR_VOTE_QUERY: EndpointQuery = {
  filters: {
    dao_slug: {
      zod: z.string().min(1).max(64),
      column: 'dao.slug',
      op: 'eq',
    },
  },
  sortable: {
    cast_at: { column: 'vote.cast_at', kind: 'time' },
    voting_power_reported: { column: 'vote.voting_power_reported', kind: 'numeric' },
  },
  defaultSort: [{ field: 'cast_at', dir: 'desc' }],
  tiebreakColumn: 'vote.id',
};
