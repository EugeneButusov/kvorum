import { sql } from 'kysely';
import request from 'supertest';
import { chDb, pgDb } from '@libs/db';
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
        .get('/v1/daos/compound/proposals/compound_governor_bravo/42')
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
        .get('/v1/daos/compound/proposals/compound_governor_bravo/999')
        .set('Authorization', seeded.bearer)
        .expect(404);
    } finally {
      await app.close();
      await resetDaoProposalApiTables();
    }
  });

  it('folds a proposal’s ClickHouse votes into a labelled per-row tally', async () => {
    const app = await createRealApp();

    try {
      await resetDaoProposalApiTables();
      const seeded = await seedDaoProposalApiData();

      // The seed declares choice 0 = for; add Against/Abstain so the row can classify all three.
      await pgDb
        .insertInto('proposal_choice')
        .values([
          { proposal_id: seeded.proposalId, choice_index: 1, value: 'against' },
          { proposal_id: seeded.proposalId, choice_index: 2, value: 'abstain' },
        ])
        .execute();

      // 750 for / 200 against / 50 abstain across four voters, written to the projection source.
      const votes = [
        { choice: 0, power: '500', voter: `0x${'a1'.repeat(20)}` },
        { choice: 0, power: '250', voter: `0x${'a2'.repeat(20)}` },
        { choice: 1, power: '200', voter: `0x${'b1'.repeat(20)}` },
        { choice: 2, power: '50', voter: `0x${'c1'.repeat(20)}` },
      ];
      await chDb
        .insertInto('vote_events_raw')
        .values(
          votes.map((v, i) => ({
            vote_id: crypto.randomUUID(),
            dao_id: seeded.daoId,
            proposal_id: seeded.proposalId,
            voter_address: v.voter,
            voting_chain_id: '1',
            primary_choice: v.choice,
            voting_power: v.power,
            cast_at: new Date('2026-05-15T10:00:00.000Z'),
            block_number: String(100 + i),
            log_index: 0,
            superseded: 0,
            superseded_at: null,
            superseded_by_vote_id: null,
          })),
        )
        .execute();

      const list = await request(app.getHttpServer())
        .get('/v1/daos/compound/proposals')
        .set('Authorization', seeded.bearer)
        .expect(200);

      const item = list.body.data.find((p: { source_id: string }) => p.source_id === '42') as {
        tally: { choices: { choice_index: number; label: string; pct: number }[] };
      };

      // 750/1000, 200/1000, 50/1000 — exact, computed server-side from the CH aggregate.
      expect(item.tally.choices).toEqual([
        { choice_index: 0, label: 'for', pct: 75 },
        { choice_index: 1, label: 'against', pct: 20 },
        { choice_index: 2, label: 'abstain', pct: 5 },
      ]);
    } finally {
      await app.close();
      await sql`TRUNCATE TABLE vote_events_raw`.execute(chDb);
      await resetDaoProposalApiTables();
    }
  });
});
