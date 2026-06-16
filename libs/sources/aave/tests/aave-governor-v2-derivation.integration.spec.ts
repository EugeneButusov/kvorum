import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  DlqRepository,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
  chDb,
  pgDb,
} from '@libs/db';
import {
  AaveGovernorV2ActorAddressDeriver,
  AaveGovernorV2ArchivePayloadRepository,
  AaveGovernorV2ProjectionApplier,
  AaveGovernorV2VoteProjectionApplier,
} from '@sources/aave';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const SOURCE_TYPE = 'aave_governor_v2';
const PROPOSAL_ID = '42';
const CREATOR = '0x1111111111111111111111111111111111111111';
const VOTER = '0x2222222222222222222222222222222222222222';
const VOTING_POWER = '15000000000000000000000';
const IPFS_HASH = '1212121212121212121212121212121212121212121212121212121212121212';

function numberedHash(n: number): string {
  return '0x' + n.toString(16).padStart(64, '0');
}

function makeMetrics() {
  return {
    batchLookupSeconds: vi.fn(),
    chWriteSeconds: vi.fn(),
    processed: vi.fn(),
    ipfsTitleFetch: vi.fn(),
  };
}

describeIf('aave governor-v2 derivation integration', () => {
  let archive: ArchiveDerivationRepository;
  let actorResolution: ArchiveActorResolutionRepository;
  let actors: ActorRepository;
  let dlq: DlqRepository;
  let payloads: AaveGovernorV2ArchivePayloadRepository;
  let actorDeriver: AaveGovernorV2ActorAddressDeriver;
  let daoSourceId = '';

  beforeAll(async () => {
    archive = new ArchiveDerivationRepository(pgDb);
    actorResolution = new ArchiveActorResolutionRepository(pgDb);
    actors = new ActorRepository(pgDb);
    dlq = new DlqRepository(pgDb);
    payloads = new AaveGovernorV2ArchivePayloadRepository(chDb);
    actorDeriver = new AaveGovernorV2ActorAddressDeriver(payloads);

    await pgDb
      .insertInto('source_type')
      .values({ value: SOURCE_TYPE })
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const daoRow = await pgDb
      .insertInto('dao')
      .values({
        slug: `aave-gov-v2-derivation-int-${Date.now()}`,
        name: 'Aave Governor v2 Derivation Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
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
        source_type: SOURCE_TYPE,
        chain_id: CHAIN_ID,
        source_config: { governor_address: '0xec568fffba86c094cf06b22134b23074dfe2252c' },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = sourceRow.id;
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, proposal, actor, ingestion_dlq, ingestion_dlq_resolved RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aave_governor_v2 DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
    await sql`ALTER TABLE vote_events_raw DELETE WHERE voting_chain_id = ${CHAIN_ID}`.execute(chDb);
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, proposal, actor, ingestion_dlq, ingestion_dlq_resolved RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aave_governor_v2 DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
    await sql`ALTER TABLE vote_events_raw DELETE WHERE voting_chain_id = ${CHAIN_ID}`.execute(chDb);
  });

  async function insertArchivedEvent(opts: {
    eventType:
      | 'ProposalCreated'
      | 'VoteEmitted'
      | 'ProposalQueued'
      | 'ProposalExecuted'
      | 'ProposalCanceled';
    blockNumber: bigint;
    logIndex: number;
    txHash: string;
    blockHash: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await chDb
      .insertInto('archive_event_aave_governor_v2')
      .values({
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: opts.blockNumber.toString(),
        block_hash: opts.blockHash,
        tx_hash: opts.txHash,
        log_index: opts.logIndex,
        event_type: opts.eventType,
        payload: JSON.stringify(opts.payload),
        received_at: new Date(`2026-01-01T00:00:0${opts.logIndex}Z`),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_aave_governor_v2'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: SOURCE_TYPE,
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: opts.blockNumber.toString(),
        block_hash: opts.blockHash,
        tx_hash: opts.txHash,
        log_index: opts.logIndex,
        event_type: opts.eventType,
        received_at: new Date(`2026-01-01T00:00:0${opts.logIndex}Z`),
        derived_at: null,
      })
      .execute();
  }

  async function resolveActors(): Promise<void> {
    const rows = await actorResolution.findUnresolvedActors(actorDeriver.eventTypes, 5, 50);
    const byKey = new Map(
      (await actorDeriver.fetchPayloads(rows)).map((payload) => [
        `${payload.chain_id}:${payload.tx_hash}:${payload.log_index}:${payload.block_hash}`,
        payload,
      ]),
    );

    for (const row of rows) {
      const payload = byKey.get(
        `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}`,
      );
      expect(payload).toBeDefined();
      const candidates = actorDeriver.extractAddresses(row.event_type, payload!.payload);
      for (const candidate of candidates) {
        await actors.findOrCreateActorAddress(candidate.address, candidate.source);
      }
      await actorResolution.markActorResolved(row.id);
    }
  }

  it('derives v2 proposal lifecycle into proposal state, actions, metadata, and per-vote voting_power', async () => {
    await insertArchivedEvent({
      eventType: 'ProposalCreated',
      blockNumber: 11_500_000n,
      logIndex: 0,
      txHash: numberedHash(1),
      blockHash: numberedHash(1001),
      payload: {
        id: PROPOSAL_ID,
        creator: CREATOR,
        executor: '0xa0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0',
        targets: ['0x311bb771e4f8952e6da169b425e7e92d6ac45756'],
        values: ['0'],
        signatures: ['enableBorrowingOnReserve(address,bool)'],
        calldatas: [
          '0xeede87c100000000000000000000000020000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001',
        ],
        withDelegatecalls: [false],
        startBlock: '11512000',
        endBlock: '11598400',
        strategy: '0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0',
        ipfsHash: `0x${IPFS_HASH}`,
      },
    });
    await insertArchivedEvent({
      eventType: 'VoteEmitted',
      blockNumber: 11_520_000n,
      logIndex: 1,
      txHash: numberedHash(2),
      blockHash: numberedHash(1002),
      payload: {
        id: PROPOSAL_ID,
        voter: VOTER,
        support: true,
        votingPower: VOTING_POWER,
      },
    });
    await insertArchivedEvent({
      eventType: 'ProposalQueued',
      blockNumber: 11_600_000n,
      logIndex: 2,
      txHash: numberedHash(3),
      blockHash: numberedHash(1003),
      payload: { id: PROPOSAL_ID, executionTime: '1700000000' },
    });
    await insertArchivedEvent({
      eventType: 'ProposalExecuted',
      blockNumber: 11_650_000n,
      logIndex: 3,
      txHash: numberedHash(4),
      blockHash: numberedHash(1004),
      payload: { id: PROPOSAL_ID },
    });

    await resolveActors();

    const proposalApplier = new AaveGovernorV2ProjectionApplier({
      pgDb,
      archive,
      dlq,
      payloads,
      ipfsFetcher: {
        fetchTitleDescription: vi.fn().mockResolvedValue({
          kind: 'resolved',
          title: 'Aave v2 test proposal',
          description: 'Test body',
        }),
      } as never,
      metrics: makeMetrics(),
      logger: silentLogger,
    });

    await proposalApplier.applyBatch(
      await actorResolution.findDerivableBy(proposalApplier.eventTypes, 20),
    );

    const proposal = await pgDb
      .selectFrom('proposal')
      .selectAll()
      .where('source_type', '=', SOURCE_TYPE)
      .where('source_id', '=', PROPOSAL_ID)
      .executeTakeFirstOrThrow();

    expect(proposal).toMatchObject({
      source_type: SOURCE_TYPE,
      source_id: PROPOSAL_ID,
      title: 'Aave v2 test proposal',
      binding: true,
      voting_starts_block: '11512000',
      voting_ends_block: '11598400',
      state: 'executed',
    });

    const actions = await pgDb
      .selectFrom('proposal_action')
      .selectAll()
      .where('proposal_id', '=', proposal.id)
      .execute();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      target_address: '0x311bb771e4f8952e6da169b425e7e92d6ac45756',
      target_chain_id: CHAIN_ID,
      function_signature: 'enableBorrowingOnReserve(address,bool)',
    });

    const metadata = await pgDb
      .selectFrom('aave_proposal_metadata')
      .selectAll()
      .where('proposal_id', '=', proposal.id)
      .executeTakeFirstOrThrow();

    expect(metadata).toMatchObject({
      voting_chain_id: CHAIN_ID,
      voting_machine_address: null,
      creation_block: '11500000',
    });

    // Vote projection — bypass VoteBlockTimestampFetcher (it validates block hash round-trip
    // against eth_getBlockByHash which we cannot satisfy in integration tests without a real
    // RPC node). Replace blockTimestamps with a pre-built map keyed by the VoteEmitted block.
    const VOTE_BLOCK_NUMBER = '11520000';
    const VOTE_BLOCK_HASH = numberedHash(1002); // matches blockHash used in insertArchivedEvent above
    const voteApplier = new AaveGovernorV2VoteProjectionApplier({
      archive,
      dlq,
      payloads,
      proposals: new ProposalRepository(pgDb),
      voteRead: new VoteEventsProjectionReadRepository(chDb),
      voteWrite: new VoteEventsProjectionWriter(chDb),
      metrics: makeMetrics(),
      registry: { peek: vi.fn().mockReturnValue({ chainCfg: { chainId: CHAIN_ID } }) } as never,
      logger: silentLogger,
    });
    (
      voteApplier as unknown as {
        blockTimestamps: {
          fetchBatch: () => Promise<Map<string, Date>>;
          resultKey: (blockNumber: string, blockHash: string) => string;
        };
      }
    ).blockTimestamps = {
      fetchBatch: async () =>
        new Map([
          [
            `${VOTE_BLOCK_NUMBER}:${VOTE_BLOCK_HASH.toLowerCase()}`,
            new Date('2026-01-01T00:00:01Z'),
          ],
        ]),
      resultKey: (blockNumber: string, blockHash: string) =>
        `${blockNumber}:${blockHash.toLowerCase()}`,
    };

    await voteApplier.applyBatch(await actorResolution.findDerivableBy(voteApplier.eventTypes, 20));

    const voteRows = await chDb
      .selectFrom('vote_events_projection')
      .selectAll()
      .where('proposal_id', '=', proposal.id)
      .execute();

    expect(voteRows.length).toBeGreaterThanOrEqual(1);
    const voteRow = voteRows.find((r) => r.voter_address === VOTER);
    expect(voteRow).toBeDefined();
    expect(voteRow).toMatchObject({
      voting_power: VOTING_POWER,
      primary_choice: 1,
      voting_chain_id: CHAIN_ID,
    });

    expect(await pgDb.selectFrom('ingestion_dlq').selectAll().execute()).toHaveLength(0);
  }, 30_000);
});
