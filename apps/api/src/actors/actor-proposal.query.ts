import { z } from 'zod';
import type { EndpointQuery } from '../query/query-descriptor';

export const ACTOR_PROPOSAL_QUERY: EndpointQuery = {
  filters: {
    // Named `dao`, comma-delimited, matching /v1/proposals and the published schema. It was
    // `dao_slug` with single-value `eq` — a name the OpenAPI document never advertised, so every
    // client following the schema got a 400. Adopting the documented name means adopting the
    // documented semantics too: with `eq`, a conforming client sending `dao=a,b` would have matched
    // nothing and received an empty 200, which is worse than the honest error it replaced.
    dao: {
      zod: z.string().min(1).max(64),
      column: 'dao.slug',
      op: 'in',
      multi: true,
      doc: 'Comma-delimited DAO slugs',
    },
  },
  sortable: {
    created_at: { column: 'proposal.created_at', kind: 'time' },
    voting_starts_at: { column: 'proposal.voting_starts_at', nullable: true, kind: 'time' },
  },
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
  tiebreakColumn: 'proposal.id',
};
