import request from 'supertest';
import { EMBEDDING_VERSION } from '@libs/ai';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
  seedDaoProposalApiData,
} from './dao-proposal-api.e2e.helpers';

describeHttpIf('proposal similar e2e', () => {
  it('returns an empty ranked set with AI provenance _meta when the corpus has no embeddings', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData(); // no proposal_embedding seeded

      const res = await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor_bravo/42/similar')
        .set('Authorization', seeded.bearer)
        .expect(200);

      // Unembedded target degrades to an empty set (SPEC §5.8) — not a 404.
      expect(res.body.data).toEqual([]);
      expect(res.body._meta).toEqual({
        ai_generated: true,
        embedding_version: EMBEDDING_VERSION,
      });
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('404s when the target proposal does not resolve', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();

      await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor_bravo/999/similar')
        .set('Authorization', seeded.bearer)
        .expect(404);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('400s when limit is out of range', async () => {
    const app = await createRealApp();
    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();

      await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals/compound_governor_bravo/42/similar?limit=999')
        .set('Authorization', seeded.bearer)
        .expect(400);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });
});
