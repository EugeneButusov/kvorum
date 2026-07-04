import request, { type Response } from 'supertest';
import { AAVE_VOTER_ADDRESS, seedAaveData } from './aave.seed';
import { seedConformanceData } from './conformance.seed';
import {
  LIDO_ARAGON_SOURCE_ID,
  LIDO_SNAPSHOT_SOURCE_ID,
  LIDO_VOTER_ADDRESS,
  seedLidoData,
} from './lido.seed';
import {
  createRealApp,
  describeHttpIf,
  resetClickhouse,
  resetDaoProposalApiTables,
} from '../../apps/api/tests/dao-proposal-api.e2e.helpers';

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const TS_SECONDS_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

type EndpointCase = {
  name: string;
  path: string;
  expectedStatus?: number;
  // ETag computed from raw body (includes non-normalized derived_through); skip pinning
  // for CH-backed endpoints whose watermark changes every seed run.
  skipEtag?: boolean;
};

// Normalize non-deterministic CH watermark timestamps before snapshot.
// vote_events_raw.version defaults to now64(6) on insert, so derived_through changes every run.
function normalizeAnalyticsMeta(body: Record<string, unknown>): Record<string, unknown> {
  const meta = body['_meta'];
  if (meta !== null && typeof meta === 'object') {
    const m = meta as Record<string, unknown>;
    if ('derived_through' in m && m['derived_through'] !== null) {
      return { ...body, _meta: { ...m, derived_through: '<datetime>' } };
    }
  }
  return body;
}

const ENDPOINTS: EndpointCase[] = [
  { name: 'daos-list', path: '/v1/daos' },
  { name: 'dao-detail', path: '/v1/daos/compound' },
  { name: 'dao-sources', path: '/v1/daos/compound/sources' },
  { name: 'dao-proposals-list', path: '/v1/daos/compound/proposals' },
  { name: 'proposal-detail', path: '/v1/daos/compound/proposals/compound_governor_bravo/42' },
  { name: 'cross-dao-proposals', path: '/v1/proposals?dao=compound' },
  // Aave entity endpoints (X3 PR1 harness)
  { name: 'aave-proposals-list', path: '/v1/daos/aave/proposals' },
  {
    name: 'aave-proposal-detail',
    path: `/v1/daos/aave/proposals/aave_governance_v3/${1}`,
  },
  { name: 'cross-dao-proposals-multi', path: '/v1/proposals?dao=compound,aave' },
  // Analytics endpoints (X3 PR2 — analytics correct for Aave + cross-DAO)
  { name: 'compound-proposal-pass-rate', path: '/v1/daos/compound/analytics/proposal-pass-rate' },
  { name: 'aave-proposal-pass-rate', path: '/v1/daos/aave/analytics/proposal-pass-rate' },
  // concentration: Aave returns 204 (no power-bearing delegation, ADR-061 rule 8)
  {
    name: 'aave-concentration',
    path: '/v1/daos/aave/analytics/concentration',
    expectedStatus: 204,
  },
  // Aave analytics endpoints (X3 PR4 — conformance completeness)
  { name: 'aave-delegation-flow', path: '/v1/daos/aave/analytics/delegation-flow' },
  {
    name: 'aave-delegate-alignment',
    path: `/v1/daos/aave/analytics/delegate-alignment?delegate=${AAVE_VOTER_ADDRESS}`,
    skipEtag: true,
  },
  // Lido four-track + Snapshot + forum conformance fixtures (M4)
  { name: 'lido-sources', path: '/v1/daos/lido/sources' },
  { name: 'lido-proposals-list', path: '/v1/daos/lido/proposals' },
  {
    name: 'lido-aragon-proposal-detail',
    path: `/v1/daos/lido/proposals/aragon_voting/${LIDO_ARAGON_SOURCE_ID}`,
  },
  {
    name: 'lido-snapshot-proposal-detail',
    path: `/v1/daos/lido/proposals/snapshot/${LIDO_SNAPSHOT_SOURCE_ID}`,
  },
  {
    name: 'lido-snapshot-vote',
    path: `/v1/daos/lido/proposals/snapshot/${LIDO_SNAPSHOT_SOURCE_ID}/votes/${LIDO_VOTER_ADDRESS}`,
  },
];

function assertProblemShape(res: Response, expectedStatus: number) {
  expect(res.headers['content-type']).toContain('application/problem+json');
  expect(res.body.status).toBe(expectedStatus);
  expect(typeof res.body.type).toBe('string');
  expect(typeof res.body.title).toBe('string');
  expect(typeof res.body.detail).toBe('string');
  expect(typeof res.body.instance).toBe('string');
}

function assertLinksAndMeta(body: unknown) {
  if (body === null || typeof body !== 'object') return;

  const asRecord = body as Record<string, unknown>;
  const meta = asRecord['_meta'];
  if (meta === null || typeof meta !== 'object') return;

  const metaRecord = meta as Record<string, unknown>;
  const lastUpdatedAt = metaRecord['last_updated_at'];
  if (typeof lastUpdatedAt === 'string') {
    expect(lastUpdatedAt).toMatch(TS_SECONDS_UTC_RE);
  }

  const links = metaRecord['links'];
  expect(links).toBeDefined();
  if (links !== null && typeof links === 'object') {
    const linksRecord = links as Record<string, unknown>;
    expect(typeof linksRecord['self']).toBe('string');
    expect(linksRecord).not.toHaveProperty('forum');
  }
}

function assertProposalShape(proposal: Record<string, unknown>) {
  if (proposal['title'] === null) {
    expect(proposal['title']).toBeNull();
  }

  if (proposal['voting_starts_at'] !== null) {
    expect(proposal['voting_starts_at']).toMatch(TS_SECONDS_UTC_RE);
  }
  if (proposal['voting_ends_at'] !== null) {
    expect(proposal['voting_ends_at']).toMatch(TS_SECONDS_UTC_RE);
  }

  const proposer = proposal['proposer'];
  expect(proposer).toBeDefined();
  if (proposer !== null && typeof proposer === 'object') {
    expect((proposer as Record<string, unknown>)['address']).toMatch(ADDRESS_RE);
  }

  assertLinksAndMeta(proposal);
  expect((proposal['_meta'] as Record<string, unknown>)['confirmed']).toBe(true);
  expect(proposal).not.toHaveProperty('tally');
}

// ADR-039/043/044 invariants are asserted explicitly in this suite.
describeHttpIf('M1 H6 conformance baseline e2e', () => {
  it('pins body shape snapshots and etag snapshots for all six endpoints', async () => {
    const app = await createRealApp();

    try {
      const seeded = await seedConformanceData();
      await seedAaveData(); // additive: Aave DAO + CH votes/delegations
      await seedLidoData(); // additive: Lido four-track + Snapshot + forum fixtures
      const server = app.getHttpServer();

      const etagByEndpoint: Record<string, string | null> = {};

      for (const endpoint of ENDPOINTS) {
        const expectedStatus = endpoint.expectedStatus ?? 200;
        const res = await request(server)
          .get(endpoint.path)
          .set('Authorization', seeded.bearer)
          .expect(expectedStatus);

        if (expectedStatus === 204) {
          // 204 has no body — only assert ETag absent and Cache-Control present
          expect(res.headers['etag']).toBeUndefined();
          expect(res.headers['cache-control']).toMatch(/max-age=60/);
          etagByEndpoint[endpoint.name] = null;
        } else {
          const body = normalizeAnalyticsMeta(res.body as Record<string, unknown>);
          expect(body).toMatchSnapshot(endpoint.name);
          etagByEndpoint[endpoint.name] = endpoint.skipEtag
            ? null
            : typeof res.headers['etag'] === 'string'
              ? res.headers['etag']
              : null;
        }
      }

      const actorRes = await request(server)
        .get(`/v1/actors/${seeded.actorPrimaryAddress}`)
        .set('Authorization', seeded.bearer)
        .expect(200);
      expect(actorRes.body).toMatchSnapshot('actor-detail');
      etagByEndpoint['actor-detail'] =
        typeof actorRes.headers['etag'] === 'string' ? actorRes.headers['etag'] : null;

      expect(etagByEndpoint).toMatchSnapshot('etag-by-endpoint');
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
      await resetClickhouse();
    }
  });

  it('asserts explicit section 4.7 invariants and error shape contracts', async () => {
    const app = await createRealApp();

    try {
      const seeded = await seedConformanceData();
      await seedAaveData(); // additive: Aave DAO + CH votes/delegations
      await seedLidoData(); // additive: Lido four-track + Snapshot + forum fixtures
      const server = app.getHttpServer();

      const daoList = await request(server)
        .get('/v1/daos?limit=2')
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(Array.isArray(daoList.body.data)).toBe(true);
      expect(daoList.body.pagination).toEqual(
        expect.objectContaining({
          limit: 2,
          has_more: expect.any(Boolean),
        }),
      );
      expect(
        daoList.body.pagination.next_cursor === null ||
          typeof daoList.body.pagination.next_cursor === 'string',
      ).toBe(true);

      for (const dao of daoList.body.data as Record<string, unknown>[]) {
        expect(dao['primary_token_address']).toMatch(ADDRESS_RE);
        assertLinksAndMeta(dao);
      }

      const daoDetail = await request(server)
        .get('/v1/daos/compound')
        .set('Authorization', seeded.bearer)
        .expect(200);

      const detailData = daoDetail.body.data as Record<string, unknown>;
      expect(detailData).toHaveProperty('sources');
      for (const source of detailData['sources'] as Record<string, unknown>[]) {
        if (source['contract_address'] !== undefined) {
          expect(source['contract_address']).toMatch(ADDRESS_RE);
        }
      }
      const proposalDetail = await request(server)
        .get('/v1/daos/compound/proposals/compound_governor_bravo/42')
        .set('Authorization', seeded.bearer)
        .expect(200);

      const proposalDetailData = proposalDetail.body.data as Record<string, unknown>;
      assertProposalShape(proposalDetailData);

      const links = ((proposalDetailData['_meta'] as Record<string, unknown>)['links'] ??
        {}) as Record<string, unknown>;
      expect(links['self']).toBe('/v1/daos/compound/proposals/compound_governor_bravo/42');
      expect(links['votes']).toBe('/v1/daos/compound/proposals/compound_governor_bravo/42/votes');

      const actions = proposalDetailData['actions'] as Record<string, unknown>[];
      for (const action of actions) {
        expect(action['target_address']).toMatch(ADDRESS_RE);
        expect(typeof action['value_wei']).toBe('string');
      }

      expect(proposalDetailData['choices']).toEqual([
        { choice_index: 0, value: 'Against' },
        { choice_index: 1, value: 'For' },
        { choice_index: 2, value: 'Abstain' },
      ]);

      const perDaoList = await request(server)
        .get('/v1/daos/compound/proposals?limit=50')
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(Array.isArray(perDaoList.body.data)).toBe(true);
      expect(perDaoList.body.pagination).toEqual(
        expect.objectContaining({
          limit: 50,
          has_more: expect.any(Boolean),
        }),
      );
      expect(
        perDaoList.body.pagination.next_cursor === null ||
          typeof perDaoList.body.pagination.next_cursor === 'string',
      ).toBe(true);

      const nullWindowProposal = (perDaoList.body.data as Record<string, unknown>[]).find(
        (item) => item['source_id'] === seeded.proposalWithNullVotingWindowSourceId,
      );
      expect(nullWindowProposal).toBeDefined();
      expect((nullWindowProposal as Record<string, unknown>)['voting_starts_at']).toBeNull();
      expect((nullWindowProposal as Record<string, unknown>)['voting_ends_at']).toBeNull();

      const crossDaoList = await request(server)
        .get('/v1/proposals?dao=compound&limit=50')
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(Array.isArray(crossDaoList.body.data)).toBe(true);
      for (const proposal of crossDaoList.body.data as Record<string, unknown>[]) {
        assertProposalShape(proposal);
      }

      const notFound = await request(server)
        .get('/v1/daos/nope')
        .set('Authorization', seeded.bearer)
        .expect(404);
      assertProblemShape(notFound, 404);

      const baselinePage = await request(server)
        .get('/v1/daos/compound/proposals?limit=1')
        .set('Authorization', seeded.bearer)
        .expect(200);

      const nextCursor = baselinePage.body.pagination.next_cursor as string | null;
      expect(typeof nextCursor).toBe('string');

      if (typeof nextCursor === 'string') {
        const mismatch = await request(server)
          .get(
            `/v1/daos/compound/proposals?state=executed&limit=1&cursor=${encodeURIComponent(nextCursor)}`,
          )
          .set('Authorization', seeded.bearer)
          .expect(400);

        assertProblemShape(mismatch, 400);
        expect(mismatch.body.type).toBe('urn:error:cursor-parameter-mismatch');
      }

      // ADR-061 rule 8: concentration returns 204 for a DAO with no power-bearing delegation.
      // Aave uses relationship-only delegation (voting_power='0'), so the entire window sums to 0.
      const aaveConcentration = await request(server)
        .get('/v1/daos/aave/analytics/concentration')
        .set('Authorization', seeded.bearer)
        .expect(204);
      expect(aaveConcentration.headers['etag']).toBeUndefined();
      expect(aaveConcentration.headers['cache-control']).toMatch(/max-age=60/);

      // proposal-pass-rate is PG-backed; derived_through is always null (no CH watermark).
      const aavePassRate = await request(server)
        .get('/v1/daos/aave/analytics/proposal-pass-rate')
        .set('Authorization', seeded.bearer)
        .expect(200);
      expect(aavePassRate.body._meta.derived_through).toBeNull();
      const passRateSourceTypes = (aavePassRate.body.data as { source_type: string }[]).map(
        (r) => r.source_type,
      );
      expect(passRateSourceTypes).toContain('aave_governance_v3');
      expect(passRateSourceTypes).toContain('aave_governor_v2');

      // cross-DAO proposals filter must include both DAOs.
      const multiDaoProposals = await request(server)
        .get('/v1/proposals?dao=compound,aave')
        .set('Authorization', seeded.bearer)
        .expect(200);
      const slugs = [
        ...new Set((multiDaoProposals.body.data as { dao_slug: string }[]).map((p) => p.dao_slug)),
      ];
      expect(slugs).toContain('compound');
      expect(slugs).toContain('aave');
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
      await resetClickhouse();
    }
  });
});
