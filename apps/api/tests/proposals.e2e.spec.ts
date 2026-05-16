import request from 'supertest';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
  seedDaoProposalApiData,
} from './dao-proposal-api.e2e.helpers';

describeHttpIf('proposal endpoints e2e', () => {
  it('supports detail/list/cross-dao with cursor and auth', async () => {
    const app = await createRealApp();

    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();

      await request(app.getHttpServer()).get('/v1/proposals').expect(401);

      const detail = await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor/42')
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(detail.body.data.source_id).toBe('42');
      expect(detail.body.data.actions.length).toBeGreaterThan(0);
      expect(detail.body.data.choices.length).toBeGreaterThan(0);
      expect(detail.body.data.tally).toBeUndefined();

      const list1 = await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals?limit=1')
        .set('Authorization', seeded.bearer)
        .expect(200);

      const cursor = list1.body.pagination.next_cursor;
      if (cursor) {
        await request(app.getHttpServer())
          .get(`/v1/daos/compound/proposals?limit=1&cursor=${encodeURIComponent(cursor)}`)
          .set('Authorization', seeded.bearer)
          .expect(200);
      }

      await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals?unknown=1')
        .set('Authorization', seeded.bearer)
        .expect(400);

      await request(app.getHttpServer())
        .get('/v1/proposals?dao=compound,aave')
        .set('Authorization', seeded.bearer)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body.data)).toBe(true);
        });

      await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor/999')
        .set('Authorization', seeded.bearer)
        .expect(404);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });
});
