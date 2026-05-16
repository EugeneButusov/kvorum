import request from 'supertest';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
  seedDaoProposalApiData,
} from './dao-proposal-api.e2e.helpers';

describeHttpIf('dao endpoints e2e', () => {
  it('requires bearer auth, returns paginated list, detail and sources with etag', async () => {
    const app = await createRealApp();

    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();

      await request(app.getHttpServer()).get('/v1/daos').expect(401);

      const list1 = await request(app.getHttpServer())
        .get('/v1/daos?limit=1')
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(Array.isArray(list1.body.data)).toBe(true);
      expect(list1.body.pagination.limit).toBe(1);

      const detail = await request(app.getHttpServer())
        .get('/v1/daos/compound')
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(detail.body.data.slug).toBe('compound');
      expect(detail.body.data.sources[0].chain_id).toBeDefined();
      expect(detail.headers['etag']).toBeDefined();

      await request(app.getHttpServer())
        .get('/v1/daos/nope')
        .set('Authorization', seeded.bearer)
        .expect(404)
        .expect((res) => {
          expect(res.headers['content-type']).toContain('application/problem+json');
        });

      const etag = String(detail.headers['etag']);
      await request(app.getHttpServer())
        .get('/v1/daos/compound')
        .set('Authorization', seeded.bearer)
        .set('If-None-Match', etag)
        .expect(304);

      await request(app.getHttpServer())
        .get('/v1/daos/compound/sources')
        .set('Authorization', seeded.bearer)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });
});
