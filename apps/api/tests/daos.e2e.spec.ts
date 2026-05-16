import request from 'supertest';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
  seedDaoProposalApiData,
} from './dao-proposal-api.e2e.helpers';

describeHttpIf('dao endpoints e2e', () => {
  it('requires bearer auth, returns paginated list with cursor, detail, sources, etag, and 404', async () => {
    const app = await createRealApp();

    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();

      await request(app.getHttpServer()).get('/v1/daos').expect(401);

      // Page 1 — seeded DAOs are 'aave' and 'compound'; default sort is slug asc so 'aave' comes first.
      const list1 = await request(app.getHttpServer())
        .get('/v1/daos?limit=1')
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(Array.isArray(list1.body.data)).toBe(true);
      expect(list1.body.data[0].slug).toBe('aave');
      expect(list1.body.pagination.limit).toBe(1);
      expect(list1.body.pagination.has_more).toBe(true);
      const daoCursor = String(list1.body.pagination.next_cursor);
      expect(daoCursor).toBeTruthy();

      // Page 2 — cursor advances past 'aave', returns 'compound'. No overlap.
      const list2 = await request(app.getHttpServer())
        .get(`/v1/daos?limit=1&cursor=${encodeURIComponent(daoCursor)}`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(list2.body.data[0].slug).toBe('compound');
      expect(list2.body.data[0].slug).not.toBe(list1.body.data[0].slug);

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
          expect(res.body.detail).toBeDefined();
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
