import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EndpointQuery } from './query-descriptor';
import { parseQuery } from './query-parser';
import { ACTOR_PROPOSAL_QUERY } from '../actors/actor-proposal.query';
import { ACTOR_VOTE_QUERY } from '../actors/actor-vote.query';
import { DAO_LIST_QUERY } from '../daos/dao.query';
import { DELEGATION_QUERY } from '../delegations/delegation.query';
import { CROSS_DAO_PROPOSAL_QUERY, PER_DAO_PROPOSAL_QUERY } from '../proposals/proposal.query';
import { VOTE_QUERY } from '../votes/vote.query';

type OpenApiDoc = {
  paths: Record<string, { get?: { parameters?: Array<{ name: string; in: string }> } | undefined }>;
};

const doc = JSON.parse(
  readFileSync(join(process.cwd(), '../../docs/openapi.json'), 'utf8'),
) as OpenApiDoc;

/** Everything a list endpoint accepts that is not an endpoint-specific filter. */
const UNIVERSAL = new Set(['limit', 'cursor', 'sort']);

function documentedFilters(path: string): string[] {
  const params = doc.paths[path]?.get?.parameters ?? [];
  return params
    .filter((p) => p.in === 'query' && !UNIVERSAL.has(p.name))
    .map((p) => p.name)
    .sort();
}

const ENDPOINTS: Array<{ path: string; query: EndpointQuery }> = [
  { path: '/v1/actors/{address}/votes', query: ACTOR_VOTE_QUERY },
  { path: '/v1/actors/{address}/proposals', query: ACTOR_PROPOSAL_QUERY },
  { path: '/v1/daos', query: DAO_LIST_QUERY },
  { path: '/v1/daos/{slug}/delegations', query: DELEGATION_QUERY },
  { path: '/v1/daos/{slug}/proposals', query: PER_DAO_PROPOSAL_QUERY },
  { path: '/v1/daos/{slug}/proposals/{source_type}/{source_id}/votes', query: VOTE_QUERY },
  { path: '/v1/proposals', query: CROSS_DAO_PROPOSAL_QUERY },
];

/**
 * The published OpenAPI document and the parser must agree about which filters exist.
 *
 * They did not. `ApiListQueryDto` carried a hand-written filter list and was reused by eight
 * controllers, so the schema advertised the `/v1/proposals` filters everywhere — accurate for that
 * one endpoint. A client following it got `400 unknown filter parameter 'dao'` from
 * `/v1/actors/{address}/votes`, which is exactly how the delegate scorecard's vote history came up
 * empty. Nothing tested the query contract, so the drift was invisible.
 *
 * These tests read the committed document rather than booting the app, so they run in the unit
 * suite. Regenerate it with `pnpm openapi:generate` after changing any descriptor.
 */
describe('query contract: OpenAPI document vs parser', () => {
  it.each(ENDPOINTS)('$path documents exactly the filters it accepts', ({ path, query }) => {
    expect(documentedFilters(path)).toEqual(Object.keys(query.filters).sort());
  });

  it.each(ENDPOINTS)('$path accepts every filter it documents', ({ path, query }) => {
    for (const name of documentedFilters(path)) {
      const filter = query.filters[name];
      expect(filter, `${path} documents '${name}' but the parser has no such filter`).toBeDefined();
      // A documented filter must survive parsing; the value shape comes from the filter's own zod.
      expect(() => parseQuery({ [name]: sampleFor(name) }, query)).not.toThrow();
    }
  });

  it('rejects a filter no endpoint declares', () => {
    expect(() => parseQuery({ nonsense: 'x' }, ACTOR_VOTE_QUERY)).toThrow();
  });
});

describe('actor list endpoints: the `dao` filter', () => {
  it.each([
    ['votes', ACTOR_VOTE_QUERY],
    ['proposals', ACTOR_PROPOSAL_QUERY],
  ] as const)('%s accepts the documented `dao` name', (_label, query) => {
    expect(() => parseQuery({ dao: 'compound' }, query)).not.toThrow();
  });

  it('treats `dao` as comma-delimited, as the description promises', () => {
    // The reason the rename could not be name-only: with single-value `eq`, a conforming client
    // sending two slugs would match nothing and get an empty 200 rather than an error.
    const filter = parseQuery({ dao: 'compound,aave' }, ACTOR_VOTE_QUERY).filters['dao'];

    expect(filter?.op).toBe('in');
    expect(filter?.value).toEqual(['compound', 'aave']);
  });

  it('no longer accepts the undocumented `dao_slug` name', () => {
    expect(() => parseQuery({ dao_slug: 'compound' }, ACTOR_VOTE_QUERY)).toThrow();
  });
});

/** A value that satisfies the filter's zod schema, keyed by the shapes actually in use. */
function sampleFor(name: string): string {
  if (name === 'proposer' || name === 'delegator' || name === 'delegate' || name === 'voter') {
    return `0x${'a'.repeat(40)}`;
  }
  if (name === 'binding') return 'true';
  if (name === 'primary_choice') return '1';
  if (name.endsWith('_min') || name.endsWith('_max')) {
    return name.startsWith('from_block') ? '100' : '2026-01-01T00:00:00.000Z';
  }
  if (name === 'from' || name === 'to') return '2026-01-01T00:00:00.000Z';
  if (name === 'created_at') return '2026-01-01T00:00:00.000Z';
  return 'compound';
}
