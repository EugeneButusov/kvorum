import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  DlqRepository,
  chDb,
  pgDb,
} from '@libs/db';
import {
  AaveVotingMachineActorAddressDeriver,
  AaveVotingMachineArchivePayloadRepository,
} from '@sources/aave';
import {
  COMPOUND_ACTOR_SWEEP_EXTRACTOR,
  CompTokenArchivePayloadRepository,
  GovernorArchivePayloadRepository,
} from '@sources/compound';
import type { ActorSweepAdapter } from '@sources/core';
import { ActorSweepService } from '../../src/derivation/actor-sweep.service';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const COMPOUND_CHAIN_ID = '0x7a69';
const AAVE_CHAIN_ID = '0x89';

function numberedHash(n: number): string {
  return '0x' + n.toString(16).padStart(64, '0');
}

describeIf('actor sweep integration', () => {
  let actorResolution: ArchiveActorResolutionRepository;
  let actors: ActorRepository;
  let dlq: DlqRepository;
  let service: ActorSweepService;
  let compoundDaoSourceId = '';
  let aaveDaoSourceId = '';

  beforeAll(async () => {
    actorResolution = new ArchiveActorResolutionRepository(pgDb);
    actors = new ActorRepository(pgDb);
    dlq = new DlqRepository(pgDb);
    const governorPayloads = new GovernorArchivePayloadRepository(chDb);
    const compTokenPayloads = new CompTokenArchivePayloadRepository(chDb);
    const compoundAdapter: ActorSweepAdapter = {
      sourceTypes: COMPOUND_ACTOR_SWEEP_EXTRACTOR.sourceTypes,
      eventTypes: COMPOUND_ACTOR_SWEEP_EXTRACTOR.eventTypes,
      extractAddresses: COMPOUND_ACTOR_SWEEP_EXTRACTOR.extractAddresses,
      fetchPayloads: async (rows) => {
        if (rows.length === 0) return [];
        const sourceType = rows[0]!.source_type;
        if (
          sourceType === 'compound_governor_alpha' ||
          sourceType === 'compound_governor_bravo' ||
          sourceType === 'compound_governor_oz'
        ) {
          return governorPayloads.fetchPayloads(rows);
        }
        if (sourceType === 'compound_comp_token') {
          return compTokenPayloads.fetchPayloads(rows);
        }
        throw new Error(`unsupported source_type for test adapter: ${sourceType}`);
      },
    };
    const aaveAdapter = new AaveVotingMachineActorAddressDeriver(
      new AaveVotingMachineArchivePayloadRepository(chDb),
    );
    service = new ActorSweepService(actorResolution, actors, dlq, [compoundAdapter, aaveAdapter]);

    await pgDb
      .insertInto('source_type')
      .values([{ value: 'compound_governor_bravo' }, { value: 'aave_voting_machine' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const daoRow = await pgDb
      .insertInto('dao')
      .values({
        slug: `actor-sweep-int-${Date.now()}`,
        name: 'Actor Sweep Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: COMPOUND_CHAIN_ID,
        description: 'integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const sourceRow = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoRow.id,
        source_type: 'compound_governor_bravo',
        chain_id: COMPOUND_CHAIN_ID,
        source_config: { governor_address: '0x' + '11'.repeat(20) },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    compoundDaoSourceId = sourceRow.id;

    const aaveSourceRow = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoRow.id,
        source_type: 'aave_voting_machine',
        chain_id: AAVE_CHAIN_ID,
        source_config: { voting_machine_address: '0x' + '22'.repeat(20) },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    aaveDaoSourceId = aaveSourceRow.id;
  }, 30_000);

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, actor, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_compound_governor_bravo DELETE WHERE chain_id = ${COMPOUND_CHAIN_ID}`.execute(
      chDb,
    );
    await sql`ALTER TABLE archive_event_aave_voting_machine DELETE WHERE chain_id = ${AAVE_CHAIN_ID}`.execute(
      chDb,
    );
  });

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, actor, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_compound_governor_bravo DELETE WHERE chain_id = ${COMPOUND_CHAIN_ID}`.execute(
      chDb,
    );
    await sql`ALTER TABLE archive_event_aave_voting_machine DELETE WHERE chain_id = ${AAVE_CHAIN_ID}`.execute(
      chDb,
    );
  });

  it('materializes actor rows once and marks actor watermark resolved', async () => {
    const txHash = numberedHash(1);
    const blockHash = numberedHash(1001);
    const voter = '0x' + 'ab'.repeat(20);

    await chDb
      .insertInto('archive_event_compound_governor_bravo')
      .values({
        dao_source_id: compoundDaoSourceId,
        chain_id: COMPOUND_CHAIN_ID,
        block_number: '100',
        block_hash: blockHash,
        tx_hash: txHash,
        log_index: 0,
        event_type: 'VoteCast',
        payload: JSON.stringify({
          voter,
          proposalId: '1',
          primaryChoice: 1,
          votingPowerReported: '1',
          compound: { supportRaw: true, reason: null },
        }),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_compound_governor_bravo'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: 'compound_governor_bravo',
        dao_source_id: compoundDaoSourceId,
        chain_id: COMPOUND_CHAIN_ID,
        block_number: '100',
        block_hash: blockHash,
        tx_hash: txHash,
        log_index: 0,
        event_type: 'VoteCast',
        received_at: new Date(),
        derived_at: null,
      })
      .execute();

    await Promise.all([service.tick(), service.tick()]);

    const actorRows = await pgDb.selectFrom('actor').selectAll().execute();
    const addressRows = await pgDb.selectFrom('actor_address').selectAll().execute();
    const confirmation = await pgDb
      .selectFrom('archive_event')
      .select(['derivation_actor_resolved_at'])
      .where('tx_hash', '=', txHash)
      .executeTakeFirstOrThrow();

    expect(actorRows).toHaveLength(1);
    expect(actorRows[0]!.primary_address).toBe(voter);
    expect(addressRows).toHaveLength(1);
    expect(addressRows[0]!.address).toBe(voter);
    expect(addressRows[0]!.source).toBe('voter_event');
    expect(confirmation.derivation_actor_resolved_at).not.toBeNull();
  }, 30_000);

  it('moves permanently failing row to DLQ at attempt threshold', async () => {
    const txHash = numberedHash(2);
    const blockHash = numberedHash(1002);

    await chDb
      .insertInto('archive_event_compound_governor_bravo')
      .values({
        dao_source_id: compoundDaoSourceId,
        chain_id: COMPOUND_CHAIN_ID,
        block_number: '101',
        block_hash: blockHash,
        tx_hash: txHash,
        log_index: 0,
        event_type: 'VoteCast',
        payload: JSON.stringify({ voter: 'bad-address' }),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_compound_governor_bravo'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: 'compound_governor_bravo',
        dao_source_id: compoundDaoSourceId,
        chain_id: COMPOUND_CHAIN_ID,
        block_number: '101',
        block_hash: blockHash,
        tx_hash: txHash,
        log_index: 0,
        event_type: 'VoteCast',
        received_at: new Date(),
        derived_at: null,
      })
      .execute();

    for (let i = 0; i < 5; i += 1) {
      await service.tick();
    }

    const dlqRows = await pgDb
      .selectFrom('ingestion_dlq')
      .selectAll()
      .where('archive_tx_hash', '=', txHash)
      .execute();
    const row = await pgDb
      .selectFrom('archive_event')
      .select(['actor_resolution_attempt_count', 'derivation_actor_resolved_at'])
      .where('tx_hash', '=', txHash)
      .executeTakeFirstOrThrow();

    expect(row.actor_resolution_attempt_count).toBe(5);
    expect(row.derivation_actor_resolved_at).toBeNull();
    expect(dlqRows.length).toBeGreaterThanOrEqual(1);
    expect(dlqRows[0]!.stage).toBe('actor_resolution_stage');
  }, 30_000);

  it('materializes a voter actor for VoteEmitted and resolves a no-address terminal event', async () => {
    const voteTxHash = numberedHash(3);
    const voteBlockHash = numberedHash(1003);
    const voter = '0x' + 'cd'.repeat(20);

    await chDb
      .insertInto('archive_event_aave_voting_machine')
      .values({
        dao_source_id: aaveDaoSourceId,
        chain_id: AAVE_CHAIN_ID,
        block_number: '102',
        block_hash: voteBlockHash,
        tx_hash: voteTxHash,
        log_index: 0,
        event_type: 'VoteEmitted',
        payload: JSON.stringify({
          proposalId: '134',
          voter,
          support: true,
          votingPower: '123',
        }),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_aave_voting_machine'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: 'aave_voting_machine',
        dao_source_id: aaveDaoSourceId,
        chain_id: AAVE_CHAIN_ID,
        block_number: '102',
        block_hash: voteBlockHash,
        tx_hash: voteTxHash,
        log_index: 0,
        event_type: 'VoteEmitted',
        received_at: new Date(),
        derived_at: null,
      })
      .execute();

    const resultsTxHash = numberedHash(4);
    const resultsBlockHash = numberedHash(1004);
    await chDb
      .insertInto('archive_event_aave_voting_machine')
      .values({
        dao_source_id: aaveDaoSourceId,
        chain_id: AAVE_CHAIN_ID,
        block_number: '103',
        block_hash: resultsBlockHash,
        tx_hash: resultsTxHash,
        log_index: 1,
        event_type: 'ProposalResultsSent',
        payload: JSON.stringify({
          proposalId: '134',
          forVotes: '11',
          againstVotes: '2',
        }),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_aave_voting_machine'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: 'aave_voting_machine',
        dao_source_id: aaveDaoSourceId,
        chain_id: AAVE_CHAIN_ID,
        block_number: '103',
        block_hash: resultsBlockHash,
        tx_hash: resultsTxHash,
        log_index: 1,
        event_type: 'ProposalResultsSent',
        received_at: new Date(),
        derived_at: null,
      })
      .execute();

    await service.tick();

    const actorRows = await pgDb.selectFrom('actor').selectAll().execute();
    const addressRows = await pgDb.selectFrom('actor_address').selectAll().execute();
    const resolutionRows = await pgDb
      .selectFrom('archive_event')
      .select(['tx_hash', 'event_type', 'derivation_actor_resolved_at'])
      .where('source_type', '=', 'aave_voting_machine')
      .orderBy('tx_hash', 'asc')
      .execute();

    expect(actorRows).toHaveLength(1);
    expect(actorRows[0]!.primary_address).toBe(voter);
    expect(addressRows).toHaveLength(1);
    expect(addressRows[0]!.address).toBe(voter);
    expect(addressRows[0]!.source).toBe('voter_event');
    expect(resolutionRows).toEqual([
      {
        tx_hash: voteTxHash,
        event_type: 'VoteEmitted',
        derivation_actor_resolved_at: expect.any(Date),
      },
      {
        tx_hash: resultsTxHash,
        event_type: 'ProposalResultsSent',
        derivation_actor_resolved_at: expect.any(Date),
      },
    ]);
  }, 30_000);
});
