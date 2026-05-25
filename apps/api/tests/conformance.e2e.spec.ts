import request, { type Response } from 'supertest';
import { seedConformanceData } from './conformance.seed';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
} from './dao-proposal-api.e2e.helpers';

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const TS_SECONDS_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

type EndpointCase = {
  name: string;
  path: string;
};

const ENDPOINTS: EndpointCase[] = [
  { name: 'daos-list', path: '/v1/daos' },
  { name: 'dao-detail', path: '/v1/daos/compound' },
  { name: 'dao-sources', path: '/v1/daos/compound/sources' },
  { name: 'dao-proposals-list', path: '/v1/daos/compound/proposals' },
  { name: 'proposal-detail', path: '/v1/daos/compound/proposals/compound_governor_bravo/42' },
  { name: 'cross-dao-proposals', path: '/v1/proposals?dao=compound' },
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

  expect(typeof proposal['voting_power_block']).toBe('string');

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
      const server = app.getHttpServer();

      const etagByEndpoint: Record<string, string | null> = {};

      for (const endpoint of ENDPOINTS) {
        const res = await request(server)
          .get(endpoint.path)
          .set('Authorization', seeded.bearer)
          .expect(200);

        expect(res.body).toMatchSnapshot(endpoint.name);
        etagByEndpoint[endpoint.name] =
          typeof res.headers['etag'] === 'string' ? res.headers['etag'] : null;
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
    }
  });

  it('asserts explicit section 4.7 invariants and error shape contracts', async () => {
    const app = await createRealApp();

    try {
      const seeded = await seedConformanceData();
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
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });
});
