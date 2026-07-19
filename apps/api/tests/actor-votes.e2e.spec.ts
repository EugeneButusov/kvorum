import { sql } from 'kysely';
import request from 'supertest';
import { chDb, pgDb } from '@libs/db';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
  seedDaoProposalApiData,
} from './dao-proposal-api.e2e.helpers';

const PROPOSER_ADDRESS = `0x${'a'.repeat(40)}`;

/**
 * A vote carries only a numeric `primary_choice`; its label lives on the proposal. The actor page
 * used to render "choice #1" because the API never sent the label, so this proves the label is
 * resolved from the proposal's real declared choices — through Postgres, not a fixture.
 */
describeHttpIf('actor votes choice labels e2e', () => {
  async function seedActorWithVote(primaryChoice: number) {
    const seeded = await seedDaoProposalApiData();

    // listForActor resolves the actor's addresses from actor_address, which the base seed omits.
    const actor = await pgDb
      .selectFrom('actor')
      .select('id')
      .where('primary_address', '=', PROPOSER_ADDRESS)
      .executeTakeFirstOrThrow();
    await pgDb
      .insertInto('actor_address')
      .values({
        actor_id: actor.id,
        address: PROPOSER_ADDRESS,
        is_primary: true,
        source: 'voter_event',
      })
      .onConflict((oc) => oc.columns(['actor_id', 'address']).doNothing())
      .execute();

    // The base seed declares choice 0 = "for"; add the other two so indexes resolve distinctly.
    await pgDb
      .insertInto('proposal_choice')
      .values([
        { proposal_id: seeded.proposalId, choice_index: 1, value: 'against' },
        { proposal_id: seeded.proposalId, choice_index: 2, value: 'abstain' },
      ])
      .onConflict((oc) => oc.columns(['proposal_id', 'choice_index']).doNothing())
      .execute();

    await chDb
      .insertInto('vote_events_raw')
      .values([
        {
          vote_id: crypto.randomUUID(),
          dao_id: seeded.daoId,
          proposal_id: seeded.proposalId,
          voter_address: PROPOSER_ADDRESS,
          voting_chain_id: '1',
          primary_choice: primaryChoice,
          voting_power: '1000',
          cast_at: new Date('2026-05-15T10:00:00.000Z'),
          block_number: '100',
          log_index: 0,
          superseded: 0,
          superseded_at: null,
          superseded_by_vote_id: null,
        },
      ])
      .execute();

    return seeded;
  }

  async function cleanup() {
    await sql`TRUNCATE TABLE vote_events_raw`.execute(chDb);
    await sql`TRUNCATE TABLE vote_events_agg`.execute(chDb);
    await resetDaoProposalApiTables();
  }

  it('returns the proposal’s declared label for the vote’s choice', async () => {
    const app = await createRealApp();

    try {
      await resetDaoProposalApiTables();
      const seeded = await seedActorWithVote(1);

      const res = await request(app.getHttpServer())
        .get(`/v1/actors/${PROPOSER_ADDRESS}/votes`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      // Index 1 is "against" for this proposal — the client no longer has to guess from the number.
      expect(res.body.data[0].primary_choice).toBe(1);
      expect(res.body.data[0].choice_label).toBe('against');
    } finally {
      await app.close();
      await cleanup();
    }
  });

  it('returns a null label when the proposal declares no choice at that index', async () => {
    const app = await createRealApp();

    try {
      await resetDaoProposalApiTables();
      const seeded = await seedActorWithVote(7);

      const res = await request(app.getHttpServer())
        .get(`/v1/actors/${PROPOSER_ADDRESS}/votes`)
        .set('Authorization', seeded.bearer)
        .expect(200);

      expect(res.body.data[0].primary_choice).toBe(7);
      // Null rather than an invented label — the client falls back to showing the bare index.
      expect(res.body.data[0].choice_label).toBeNull();
    } finally {
      await app.close();
      await cleanup();
    }
  });
});
