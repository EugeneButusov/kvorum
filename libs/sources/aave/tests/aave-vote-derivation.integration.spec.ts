import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ArchiveDerivationRepository,
  chDb,
  DlqRepository,
  pgDb,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
} from '@libs/db';
import {
  AaveProposalRepository,
  AaveVotingMachineArchivePayloadRepository,
  AaveVoteProjectionApplier,
} from '@sources/aave';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const GOVERNANCE_SOURCE_TYPE = 'aave_governance_v3';
const VOTING_MACHINE_SOURCE_TYPE = 'aave_voting_machine';
const VOTING_CHAIN_ID = '0x89';
const PROPOSAL_SOURCE_ID = '42';

function numberedHash(n: number): string {
  return '0x' + n.toString(16).padStart(64, '0');
}

describeIf('aave vote derivation integration', () => {
  let archive: ArchiveDerivationRepository;
  let votingMachineDaoSourceId = '';
  let daoId = '';
  let proposerActorId = '';

  beforeAll(async () => {
    archive = new ArchiveDerivationRepository(pgDb);

    await pgDb
      .insertInto('source_type')
      .values([{ value: GOVERNANCE_SOURCE_TYPE }, { value: VOTING_MACHINE_SOURCE_TYPE }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const daoRow = await pgDb
      .insertInto('dao')
      .values({
        slug: `aave-vote-derivation-int-${Date.now()}`,
        name: 'Aave Vote Derivation Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: '0x1',
        description: 'integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoId = daoRow.id;

    const governanceSource = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoId,
        source_type: GOVERNANCE_SOURCE_TYPE,
        chain_id: '0x1',
        source_config: { governance_address: '0x' + '10'.repeat(20) },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    void governanceSource.id;

    const votingMachineSource = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoId,
        source_type: VOTING_MACHINE_SOURCE_TYPE,
        chain_id: VOTING_CHAIN_ID,
        source_config: { voting_machine_address: '0x' + '11'.repeat(20) },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    votingMachineDaoSourceId = votingMachineSource.id;

    const proposer = await pgDb
      .insertInto('actor')
      .values({
        primary_address: '0x' + 'aa'.repeat(20),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    proposerActorId = proposer.id;
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, proposal, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`TRUNCATE aave_proposal_metadata, aave_proposal_payload RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aave_voting_machine DELETE WHERE chain_id = ${VOTING_CHAIN_ID}`.execute(
      chDb,
    );
    await sql`ALTER TABLE vote_events_raw DELETE WHERE voting_chain_id = ${VOTING_CHAIN_ID}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, proposal, actor, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`TRUNCATE aave_proposal_metadata, aave_proposal_payload RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aave_voting_machine DELETE WHERE chain_id = ${VOTING_CHAIN_ID}`.execute(
      chDb,
    );
    await sql`ALTER TABLE vote_events_raw DELETE WHERE voting_chain_id = ${VOTING_CHAIN_ID}`.execute(
      chDb,
    );
  });

  it('projects VoteEmitted through ClickHouse and updates proposal metadata binding', async () => {
    const proposal = await pgDb
      .insertInto('proposal')
      .values({
        dao_id: daoId,
        source_type: GOVERNANCE_SOURCE_TYPE,
        source_id: PROPOSAL_SOURCE_ID,
        proposer_actor_id: proposerActorId,
        title: 'Test Proposal',
        description: 'desc',
        description_hash: 'a'.repeat(64),
        binding: true,
        voting_starts_at: null,
        voting_ends_at: null,
        voting_starts_block: '10',
        voting_ends_block: '20',
        state: 'pending',
        state_updated_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await pgDb
      .insertInto('aave_proposal_metadata')
      .values({
        proposal_id: proposal.id,
        voting_chain_id: null,
        voting_machine_address: null,
        voting_strategy_address: null,
        creation_block: '10',
        last_reconcile_check_block: null,
      })
      .execute();

    await chDb
      .insertInto('archive_event_aave_voting_machine')
      .values({
        dao_source_id: votingMachineDaoSourceId,
        chain_id: VOTING_CHAIN_ID,
        block_number: '100',
        block_hash: numberedHash(1001),
        tx_hash: numberedHash(1),
        log_index: 0,
        event_type: 'VoteEmitted',
        payload: JSON.stringify({
          proposalId: PROPOSAL_SOURCE_ID,
          voter: '0x' + 'ab'.repeat(20),
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
        source_type: VOTING_MACHINE_SOURCE_TYPE,
        dao_source_id: votingMachineDaoSourceId,
        chain_id: VOTING_CHAIN_ID,
        block_number: '100',
        block_hash: numberedHash(1001),
        tx_hash: numberedHash(1),
        log_index: 0,
        event_type: 'VoteEmitted',
        received_at: new Date(),
        derivation_actor_resolved_at: new Date(),
        derived_at: null,
      })
      .execute();

    const applier = new AaveVoteProjectionApplier({
      archive,
      dlq: new DlqRepository(pgDb),
      payloads: new AaveVotingMachineArchivePayloadRepository(chDb),
      proposals: new ProposalRepository(pgDb),
      aaveProposals: new AaveProposalRepository(pgDb),
      voteRead: new VoteEventsProjectionReadRepository(chDb),
      voteWrite: new VoteEventsProjectionWriter(chDb),
      metrics: {
        batchLookupSeconds: () => undefined,
        chWriteSeconds: () => undefined,
        processed: () => undefined,
      },
      registry: {
        peek: (chainId: string) =>
          chainId === VOTING_CHAIN_ID
            ? ({ client: {}, chainCfg: { chainId: VOTING_CHAIN_ID } } as never)
            : undefined,
      } as never,
    });
    (
      applier as unknown as {
        blockTimestamps: {
          fetchBatch: () => Promise<Map<string, Date>>;
          resultKey: (blockNumber: string, blockHash: string) => string;
        };
      }
    ).blockTimestamps = {
      fetchBatch: async () =>
        new Map([[`100:${numberedHash(1001)}`, new Date('2026-01-01T00:01:40Z')]]),
      resultKey: (blockNumber: string, blockHash: string) => `${blockNumber}:${blockHash}`,
    };

    await applier.applyBatch(await archive.findUnderived(['VoteEmitted'], 50));

    const votes = await chDb
      .selectFrom('vote_events_projection')
      .selectAll()
      .where('proposal_id', '=', proposal.id)
      .where('superseded', '=', 0)
      .execute();
    const metadata = await pgDb
      .selectFrom('aave_proposal_metadata')
      .select(['voting_chain_id', 'voting_machine_address'])
      .where('proposal_id', '=', proposal.id)
      .executeTakeFirstOrThrow();

    expect(votes).toHaveLength(1);
    expect(votes[0]!.voting_chain_id).toBe(VOTING_CHAIN_ID);
    expect(votes[0]!.primary_choice).toBe(1);
    expect(votes[0]!.voting_power).toBe('123');
    expect(metadata).toEqual({
      voting_chain_id: VOTING_CHAIN_ID,
      voting_machine_address: '0x' + '11'.repeat(20),
    });
  }, 30_000);
});
