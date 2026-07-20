import { z } from 'zod';
import type { EndpointQuery } from '../query/query-descriptor';

export const ACTOR_VOTE_QUERY: EndpointQuery = {
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
    cast_at: { column: 'vote.cast_at', kind: 'time' },
    voting_power_reported: { column: 'vote.voting_power_reported', kind: 'numeric' },
  },
  defaultSort: [{ field: 'cast_at', dir: 'desc' }],
  tiebreakColumn: 'vote.id',
};
