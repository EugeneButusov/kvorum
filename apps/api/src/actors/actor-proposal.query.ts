import { z } from 'zod';
import type { EndpointQuery } from '../query/query-descriptor';

export const ACTOR_PROPOSAL_QUERY: EndpointQuery = {
  filters: {
    dao_slug: {
      zod: z.string().min(1).max(64),
      column: 'dao.slug',
      op: 'eq',
    },
  },
  sortable: {
    created_at: { column: 'proposal.created_at', kind: 'time' },
    voting_starts_at: { column: 'proposal.voting_starts_at', nullable: true, kind: 'time' },
  },
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
  tiebreakColumn: 'proposal.id',
};
