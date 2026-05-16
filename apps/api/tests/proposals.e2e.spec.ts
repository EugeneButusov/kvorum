import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
  seedDaoProposalApiData,
  TEST_PROPOSER_ADDRESS,
} from './dao-proposal-api.e2e.helpers';
import type { SeedContext } from './dao-proposal-api.e2e.helpers';

describeHttpIf('proposal endpoints e2e', () => {
  let app: INestApplication;
  let seeded: SeedContext;

  beforeAll(async () => {
    app = await createRealApp();
    await resetDaoProposalApiTables();
    seeded = await seedDaoProposalApiData();
  });

  afterAll(async () => {
    await app.close();
    await resetDaoProposalApiTables();
  });

  it('requires bearer auth on per-dao and cross-dao list', async () => {
    await request(app.getHttpServer()).get('/v1/proposals').expect(401);
    await request(app.getHttpServer()).get('/v1/daos/compound/proposals').expect(401);
  });

  it('proposal detail has correct shape, etag, and 304', async () => {
    const detail = await request(app.getHttpServer())
      .get('/v1/daos/compound/proposals/compound_governor/42')
      .set('Authorization', seeded.bearer)
      .expect(200);

    expect(detail.body.data.source_id).toBe('42');
    expect(detail.body.data.actions.length).toBeGreaterThan(0);
    expect(detail.body.data.choices.length).toBeGreaterThan(0);
    expect(detail.body.data.tally).toBeUndefined();
    expect(detail.headers['etag']).toBeDefined();

    const etag = String(detail.headers['etag']);
    await request(app.getHttpServer())
      .get('/v1/daos/compound/proposals/compound_governor/42')
      .set('Authorization', seeded.bearer)
      .set('If-None-Match', etag)
      .expect(304);
  });

  it('per-dao proposal list: filters, cursor round-trip, cursor mismatch', async () => {
    // state filter
    const byState = await request(app.getHttpServer())
      .get('/v1/daos/compound/proposals?state=active')
      .set('Authorization', seeded.bearer)
      .expect(200);
    expect(byState.body.data.length).toBeGreaterThan(0);

    // binding=true returns only binding proposals; binding=false returns only non-binding
    const bindingTrue = await request(app.getHttpServer())
      .get('/v1/daos/compound/proposals?binding=true')
      .set('Authorization', seeded.bearer)
      .expect(200);
    expect(bindingTrue.body.data.every((p: { binding: boolean }) => p.binding === true)).toBe(true);

    const bindingFalse = await request(app.getHttpServer())
      .get('/v1/daos/compound/proposals?binding=false')
      .set('Authorization', seeded.bearer)
      .expect(200);
    expect(bindingFalse.body.data.every((p: { binding: boolean }) => p.binding === false)).toBe(
      true,
    );

    // proposer filter
    const byProposer = await request(app.getHttpServer())
      .get(`/v1/daos/compound/proposals?proposer=${TEST_PROPOSER_ADDRESS}`)
      .set('Authorization', seeded.bearer)
      .expect(200);
    expect(byProposer.body.data.length).toBeGreaterThan(0);

    // voting_starts_at_min excludes proposals with null voting_starts_at
    const byTimeMin = await request(app.getHttpServer())
      .get('/v1/daos/compound/proposals?voting_starts_at_min=2026-05-14T00:00:00Z')
      .set('Authorization', seeded.bearer)
      .expect(200);
    expect(byTimeMin.body.data.length).toBe(1);
    expect(byTimeMin.body.data[0].source_id).toBe('42');

    // cursor round-trip: page1 (most recent, source_id=42) → page2 (older, source_id=43), no overlap
    const page1 = await request(app.getHttpServer())
      .get('/v1/daos/compound/proposals?limit=1')
      .set('Authorization', seeded.bearer)
      .expect(200);

    expect(page1.body.data[0].source_id).toBe('42');
    expect(page1.body.pagination.has_more).toBe(true);
    const cursor = String(page1.body.pagination.next_cursor);
    expect(cursor).toBeTruthy();

    const page2 = await request(app.getHttpServer())
      .get(`/v1/daos/compound/proposals?limit=1&cursor=${encodeURIComponent(cursor)}`)
      .set('Authorization', seeded.bearer)
      .expect(200);

    expect(page2.body.data[0].source_id).toBe('43');
    expect(page2.body.data[0].source_id).not.toBe(page1.body.data[0].source_id);

    // ADR-044: conflicting filter on page2 → 400 cursor-parameter-mismatch
    await request(app.getHttpServer())
      .get(`/v1/daos/compound/proposals?limit=1&state=active&cursor=${encodeURIComponent(cursor)}`)
      .set('Authorization', seeded.bearer)
      .expect(400)
      .expect((res) => {
        expect(res.body.type).toContain('cursor-parameter-mismatch');
      });

    // unknown filter → 400
    await request(app.getHttpServer())
      .get('/v1/daos/compound/proposals?unknown=1')
      .set('Authorization', seeded.bearer)
      .expect(400);
  });

  it('cross-dao proposal list: filters and multi-dao', async () => {
    // ?dao=compound returns only compound proposals
    const compoundOnly = await request(app.getHttpServer())
      .get('/v1/proposals?dao=compound')
      .set('Authorization', seeded.bearer)
      .expect(200);
    expect(compoundOnly.body.data.length).toBeGreaterThan(0);
    expect(
      compoundOnly.body.data.every((p: { dao_slug: string }) => p.dao_slug === 'compound'),
    ).toBe(true);

    // ?dao=compound,aave returns only compound (aave has no proposals)
    const multiDao = await request(app.getHttpServer())
      .get('/v1/proposals?dao=compound,aave')
      .set('Authorization', seeded.bearer)
      .expect(200);
    expect(multiDao.body.data.every((p: { dao_slug: string }) => p.dao_slug === 'compound')).toBe(
      true,
    );
  });

  it('returns 404 with problem+json and detail for missing proposal', async () => {
    await request(app.getHttpServer())
      .get('/v1/daos/compound/proposals/compound_governor/999')
      .set('Authorization', seeded.bearer)
      .expect(404)
      .expect((res) => {
        expect(res.headers['content-type']).toContain('application/problem+json');
        expect(res.body.detail).toBeDefined();
      });
  });
});
