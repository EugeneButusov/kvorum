import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { chDb, pgDb } from './client';
import { DelegationFlowProjectionWriter } from './delegation-flow-projection-writer';
import { DelegationReadRepository } from './delegation-read-repository';
import { VoteEventsProjectionWriter } from './vote-events-projection-writer';
import { VoteReadRepository } from './vote-read-repository';

const describeWithDbAndCh =
  process.env['DATABASE_URL'] != null && process.env['CLICKHOUSE_URL'] != null
    ? describe
    : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
  await chDb.destroy();
});

// Regression guard for chTimestampToDate (libs/db/src/ch-timestamp.ts).
//
// kysely-clickhouse returns DateTime / DateTime64 columns over the HTTP JSON interface as
// timezone-less UTC strings ("YYYY-MM-DD HH:MM:SS[.fff]"), NOT JS Dates. The read repos must
// convert them to real Dates, else the API mappers' isoSeconds() (`value.toISOString()`)
// throws at runtime. The mocked unit specs cannot catch this — they hand the repos a Date —
// so this exercises the real ClickHouse driver end of the vote + delegation read repos.
describeWithDbAndCh('ClickHouse read-repository date handling (integration)', () => {
  it('VoteReadRepository.listForProposal returns cast_at as a Date, not a CH string', async () => {
    // listForProposal resolves the proposal from PG first, so seed dao + proposer + proposal.
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'aave_governance_v3' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();
    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `ch-vote-int-${Date.now()}`,
        name: 'CH Vote Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: '0x1',
        description: 'integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const actor = await pgDb
      .insertInto('actor')
      .values({ primary_address: '0x' + 'ab'.repeat(20), updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const proposal = await pgDb
      .insertInto('proposal')
      .values({
        dao_id: dao.id,
        source_type: 'aave_governance_v3',
        source_id: '1',
        proposer_actor_id: actor.id,
        title: 'vote date proposal',
        description: 'body',
        description_hash: `0x${'1'.repeat(64)}`,
        binding: true,
        voting_starts_at: new Date('2026-05-20T00:00:00Z'),
        voting_ends_at: new Date('2026-05-23T00:00:00Z'),
        voting_starts_block: '100',
        voting_ends_block: '200',
        state: 'executed',
        state_updated_at: new Date('2026-05-24T00:00:00Z'),
        updated_at: new Date('2026-05-24T00:00:00Z'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await new VoteEventsProjectionWriter(chDb).insertBatch([
      {
        vote_id: randomUUID(),
        dao_id: dao.id,
        proposal_id: proposal.id,
        voter_address: '0x' + 'ab'.repeat(20),
        voting_chain_id: '0x89',
        primary_choice: 1,
        seq: '0',
        voting_power: '1000',
        cast_at: new Date('2026-05-21T00:00:00.000Z'),
        block_number: '100',
        log_index: 0,
        superseded: 0,
        superseded_at: null,
        superseded_by_vote_id: null,
      },
    ]);

    try {
      const rows = await new VoteReadRepository().listForProposal({ proposalId: proposal.id });
      expect(rows).toHaveLength(1);
      // The bug returned a raw string here, which made the API mapper's toISOString() throw.
      expect(rows[0]!.cast_at).toBeInstanceOf(Date);
      expect(rows[0]!.cast_at.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    } finally {
      await sql`ALTER TABLE vote_events_raw DELETE WHERE proposal_id = ${proposal.id}`.execute(
        chDb,
      );
      await sql`ALTER TABLE vote_events_agg DELETE WHERE proposal_id = ${proposal.id}`.execute(
        chDb,
      );
      await pgDb.deleteFrom('proposal').where('id', '=', proposal.id).execute();
      await pgDb.deleteFrom('actor').where('id', '=', actor.id).execute();
      await pgDb.deleteFrom('dao').where('id', '=', dao.id).execute();
    }
  });

  it('DelegationReadRepository.listForDao returns created_at as a Date, not a CH string', async () => {
    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `ch-date-int-${Date.now()}`,
        name: 'CH Date Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: '0x1',
        description: 'integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await new DelegationFlowProjectionWriter(chDb).insertBatch([
      {
        delegation_id: randomUUID(),
        dao_id: dao.id,
        delegator_address: '0x' + 'cd'.repeat(20),
        delegate_address: '0x' + 'ef'.repeat(20),
        voting_power: '0',
        block_number: '200',
        log_index: 0,
        event_type: 'delegate_changed',
        created_at: new Date('2026-05-19T00:00:00.000Z'),
      },
    ]);

    try {
      const rows = await new DelegationReadRepository().listForDao({ daoId: dao.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.created_at).toBeInstanceOf(Date);
      expect(rows[0]!.created_at.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    } finally {
      await sql`ALTER TABLE delegation_flow_raw DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await sql`ALTER TABLE delegation_flow_agg DELETE WHERE dao_id = ${dao.id}`.execute(chDb);
      await pgDb.deleteFrom('dao').where('id', '=', dao.id).execute();
    }
  });
});
