import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LogEvent } from '@libs/chain';
import {
  ArchiveActorResolutionRepository,
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
  decodeAaveVotingMachineLog,
} from '@sources/aave';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const GOVERNANCE_SOURCE_TYPE = 'aave_governance_v3';
const VOTING_MACHINE_SOURCE_TYPE = 'aave_voting_machine';
const MAINNET_CHAIN_ID = '0x1';
const POLYGON_CHAIN_ID = '0x89';
const AVALANCHE_CHAIN_ID = '0xa86a';
const POLYGON_VM_ADDRESS = '0xc8a2adc4261c6b669cdff69e717e77c9cfeb420d';
const AVALANCHE_VM_ADDRESS = '0x4d1863d22d0ed8579f8999388bcc833cb057c2d6';
const POLYGON_PROPOSAL_ID = '134';
const AVALANCHE_PROPOSAL_ID = '489';
const HOLD_PROPOSAL_ID = '9999';

type FixtureLog = {
  chainId: string;
  address: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  topics: string[];
  data: string;
};

type MetricsCapture = {
  processed: Array<{ event_type: string; outcome: string; reason: string | null }>;
  stitchPending: Array<{
    seconds: number;
    labels: { voting_chain_id: string; event_type: string };
  }>;
};

function numberedHash(n: number): string {
  return '0x' + n.toString(16).padStart(64, '0');
}

function fixtureLog(name: string): FixtureLog {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', 'logs', name), 'utf8')) as FixtureLog;
}

function toRawLog(fixture: FixtureLog): LogEvent {
  return {
    chainId: fixture.chainId,
    blockNumber: fixture.blockNumber,
    blockHash: fixture.blockHash,
    txHash: fixture.txHash,
    logIndex: fixture.logIndex,
    address: fixture.address,
    topics: fixture.topics,
    data: fixture.data,
  };
}

describeIf('aave vote stitch integration', () => {
  let archive: ArchiveDerivationRepository;
  let actorResolution: ArchiveActorResolutionRepository;
  let votingMachinePayloads: AaveVotingMachineArchivePayloadRepository;
  let proposals: ProposalRepository;
  let aaveProposals: AaveProposalRepository;
  let dlq: DlqRepository;
  let voteRead: VoteEventsProjectionReadRepository;
  let voteWrite: VoteEventsProjectionWriter;
  let governanceDaoSourceId = '';
  let polygonDaoSourceId = '';
  let avalancheDaoSourceId = '';
  let daoId = '';
  let proposerActorId = '';

  beforeAll(async () => {
    archive = new ArchiveDerivationRepository(pgDb);
    actorResolution = new ArchiveActorResolutionRepository(pgDb);
    votingMachinePayloads = new AaveVotingMachineArchivePayloadRepository(chDb);
    proposals = new ProposalRepository(pgDb);
    aaveProposals = new AaveProposalRepository(pgDb);
    dlq = new DlqRepository(pgDb);
    voteRead = new VoteEventsProjectionReadRepository(chDb);
    voteWrite = new VoteEventsProjectionWriter(chDb);

    await pgDb
      .insertInto('source_type')
      .values([{ value: GOVERNANCE_SOURCE_TYPE }, { value: VOTING_MACHINE_SOURCE_TYPE }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const daoRow = await pgDb
      .insertInto('dao')
      .values({
        slug: `aave-vote-stitch-int-${Date.now()}`,
        name: 'Aave Vote Stitch Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: MAINNET_CHAIN_ID,
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
        chain_id: MAINNET_CHAIN_ID,
        source_config: { governance_address: '0x' + '10'.repeat(20) },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    governanceDaoSourceId = governanceSource.id;

    const polygonSource = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoId,
        source_type: VOTING_MACHINE_SOURCE_TYPE,
        chain_id: POLYGON_CHAIN_ID,
        source_config: { voting_machine_address: POLYGON_VM_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    polygonDaoSourceId = polygonSource.id;

    const avalancheSource = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoId,
        source_type: VOTING_MACHINE_SOURCE_TYPE,
        chain_id: AVALANCHE_CHAIN_ID,
        source_config: { voting_machine_address: AVALANCHE_VM_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    avalancheDaoSourceId = avalancheSource.id;

    const proposer = await pgDb
      .insertInto('actor')
      .values({
        primary_address: '0x' + 'aa'.repeat(20),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    proposerActorId = proposer.id;

    void governanceDaoSourceId;
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, proposal, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`TRUNCATE aave_proposal_metadata, aave_proposal_payload RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aave_voting_machine DELETE WHERE chain_id IN (${POLYGON_CHAIN_ID}, ${AVALANCHE_CHAIN_ID})`.execute(
      chDb,
    );
    await sql`ALTER TABLE vote_events_raw DELETE WHERE voting_chain_id IN (${POLYGON_CHAIN_ID}, ${AVALANCHE_CHAIN_ID})`.execute(
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
    await sql`ALTER TABLE archive_event_aave_voting_machine DELETE WHERE chain_id IN (${POLYGON_CHAIN_ID}, ${AVALANCHE_CHAIN_ID})`.execute(
      chDb,
    );
    await sql`ALTER TABLE vote_events_raw DELETE WHERE voting_chain_id IN (${POLYGON_CHAIN_ID}, ${AVALANCHE_CHAIN_ID})`.execute(
      chDb,
    );
  });

  it('stitches real Polygon and Avalanche votes, no-op derives terminal events, and holds until proposal arrival', async () => {
    const metrics = createMetricsCapture();
    const applier = createApplier(metrics);

    const polygonProposal = await insertProposal(POLYGON_PROPOSAL_ID, 'Polygon proposal');
    const avalancheProposal = await insertProposal(AVALANCHE_PROPOSAL_ID, 'Avalanche proposal');

    const polygonVote = fixtureLog('vote-emitted-polygon.json');
    const avalancheVote = fixtureLog('vote-emitted.json');
    const resultsSent = fixtureLog('proposal-results-sent.json');
    const voteConfigurationBridged = fixtureLog('proposal-vote-configuration-bridged.json');

    await insertFixtureArchiveRow(polygonDaoSourceId, polygonVote);
    await insertFixtureArchiveRow(avalancheDaoSourceId, avalancheVote);
    await insertFixtureArchiveRow(avalancheDaoSourceId, resultsSent);
    await insertFixtureArchiveRow(avalancheDaoSourceId, voteConfigurationBridged);

    await deriveBatches(applier, actorResolution, applier.eventTypes);

    const stitchedVotes = await chDb
      .selectFrom('vote_events_projection')
      .select([
        'proposal_id',
        'vote_id',
        'voter_address',
        'primary_choice',
        'voting_power',
        'voting_chain_id',
      ])
      .where('proposal_id', 'in', [polygonProposal.id, avalancheProposal.id])
      .where('superseded', '=', 0)
      .orderBy('proposal_id', 'asc')
      .execute();

    expect(stitchedVotes).toHaveLength(2);
    expect(stitchedVotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal_id: polygonProposal.id,
          voting_chain_id: POLYGON_CHAIN_ID,
          primary_choice: 1,
          voting_power: '25846908561692963309',
        }),
        expect.objectContaining({
          proposal_id: avalancheProposal.id,
          voting_chain_id: AVALANCHE_CHAIN_ID,
          primary_choice: 1,
          voting_power: '10515607793132578',
        }),
      ]),
    );

    const metadataRows = await pgDb
      .selectFrom('aave_proposal_metadata')
      .select(['proposal_id', 'voting_chain_id', 'voting_machine_address'])
      .orderBy('proposal_id', 'asc')
      .execute();
    expect(metadataRows).toEqual(
      expect.arrayContaining([
        {
          proposal_id: avalancheProposal.id,
          voting_chain_id: AVALANCHE_CHAIN_ID,
          voting_machine_address: AVALANCHE_VM_ADDRESS,
        },
        {
          proposal_id: polygonProposal.id,
          voting_chain_id: POLYGON_CHAIN_ID,
          voting_machine_address: POLYGON_VM_ADDRESS,
        },
      ]),
    );

    const derivedTerminalRows = await pgDb
      .selectFrom('archive_event')
      .select(['event_type', 'derived_at'])
      .where('event_type', 'in', [
        'ProposalResultsSent',
        'ProposalVoteConfigurationBridged',
      ] as const)
      .orderBy('event_type', 'asc')
      .execute();
    expect(derivedTerminalRows).toEqual([
      { event_type: 'ProposalResultsSent', derived_at: expect.any(Date) },
      { event_type: 'ProposalVoteConfigurationBridged', derived_at: expect.any(Date) },
    ]);
    expect(
      stitchedVotes.some((row) => row.vote_id === `${resultsSent.txHash}:${resultsSent.logIndex}`),
    ).toBe(false);
    await expectDlqRows(resultsSent.txHash, 0);

    const duplicateVoteTxHash = numberedHash(7001);
    await insertSyntheticVoteArchive({
      daoSourceId: avalancheDaoSourceId,
      chainId: AVALANCHE_CHAIN_ID,
      blockNumber: '99999999',
      blockHash: numberedHash(7002),
      txHash: duplicateVoteTxHash,
      logIndex: 7,
      payload: {
        proposalId: POLYGON_PROPOSAL_ID,
        voter: '0x51d6a97ddea04f4ae5039d84b16754db241da4fb',
        support: false,
        votingPower: '1',
      },
    });

    await deriveBatches(applier, actorResolution, ['VoteEmitted']);

    const duplicateArchiveRow = await pgDb
      .selectFrom('archive_event')
      .select(['derived_at'])
      .where('tx_hash', '=', duplicateVoteTxHash)
      .executeTakeFirstOrThrow();
    expect(duplicateArchiveRow.derived_at).toBeNull();
    expect(
      metrics.processed.some(
        (call) =>
          call.event_type === 'VoteEmitted' &&
          call.outcome === 'failed' &&
          call.reason === 'single_voting_chain_violation',
      ),
    ).toBe(true);
    await expectDlqRows(duplicateVoteTxHash, 0);

    const heldVoteTxHash = numberedHash(8001);
    await insertSyntheticVoteArchive({
      daoSourceId: polygonDaoSourceId,
      chainId: POLYGON_CHAIN_ID,
      blockNumber: '99999998',
      blockHash: numberedHash(8002),
      txHash: heldVoteTxHash,
      logIndex: 8,
      receivedAt: new Date('2026-01-02T00:00:00Z'),
      payload: {
        proposalId: HOLD_PROPOSAL_ID,
        voter: '0x' + 'bc'.repeat(20),
        support: true,
        votingPower: '77',
      },
    });

    const nowMs = Date.now;
    Date.now = () => new Date('2026-01-02T00:03:00Z').getTime();
    try {
      await deriveBatches(applier, actorResolution, ['VoteEmitted']);
    } finally {
      Date.now = nowMs;
    }

    const heldArchiveRow = await pgDb
      .selectFrom('archive_event')
      .select(['derived_at'])
      .where('tx_hash', '=', heldVoteTxHash)
      .executeTakeFirstOrThrow();
    expect(heldArchiveRow.derived_at).toBeNull();
    expect(
      metrics.processed.some(
        (call) =>
          call.event_type === 'VoteEmitted' &&
          call.outcome === 'held' &&
          call.reason === 'no_proposal',
      ),
    ).toBe(true);
    expect(
      metrics.stitchPending.some(
        (entry) =>
          entry.seconds === 180 &&
          entry.labels.voting_chain_id === POLYGON_CHAIN_ID &&
          entry.labels.event_type === 'VoteEmitted',
      ),
    ).toBe(true);
    await expectDlqRows(heldVoteTxHash, 0);

    await insertProposal(HOLD_PROPOSAL_ID, 'Held proposal');
    await deriveBatches(applier, actorResolution, ['VoteEmitted']);

    const resolvedHeldRow = await pgDb
      .selectFrom('archive_event')
      .select(['derived_at'])
      .where('tx_hash', '=', heldVoteTxHash)
      .executeTakeFirstOrThrow();
    expect(resolvedHeldRow.derived_at).not.toBeNull();
    expect(
      metrics.stitchPending.some(
        (entry) =>
          entry.seconds === 0 &&
          entry.labels.voting_chain_id === POLYGON_CHAIN_ID &&
          entry.labels.event_type === 'VoteEmitted',
      ),
    ).toBe(true);

    const archiveVoteCount = await pgDb
      .selectFrom('archive_event')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('source_type', '=', VOTING_MACHINE_SOURCE_TYPE)
      .where('event_type', '=', 'VoteEmitted')
      .where('derived_at', 'is not', null)
      .executeTakeFirstOrThrow();
    expect(Number(archiveVoteCount.count)).toBe(3);
  }, 30_000);

  function createApplier(metrics: MetricsCapture): AaveVoteProjectionApplier {
    const applier = new AaveVoteProjectionApplier({
      archive,
      dlq,
      payloads: votingMachinePayloads,
      proposals,
      aaveProposals,
      voteRead,
      voteWrite,
      metrics: {
        batchLookupSeconds: () => undefined,
        chWriteSeconds: () => undefined,
        stitchPendingSeconds: (seconds, labels) => {
          metrics.stitchPending.push({ seconds, labels });
        },
        processed: (labels) => {
          metrics.processed.push(labels);
        },
      },
      registry: {
        peek: (chainId: string) =>
          chainId === POLYGON_CHAIN_ID || chainId === AVALANCHE_CHAIN_ID
            ? ({ client: {}, chainCfg: { chainId } } as never)
            : undefined,
      } as never,
    });

    (
      applier as unknown as {
        blockTimestamps: {
          fetchBatch: (
            _chainCtx: unknown,
            rows: Array<{ blockNumber: string; blockHash: string }>,
          ) => Promise<Map<string, Date>>;
          resultKey: (blockNumber: string, blockHash: string) => string;
        };
      }
    ).blockTimestamps = {
      fetchBatch: async (_chainCtx, rows) =>
        new Map(
          rows.map((row) => [
            `${row.blockNumber}:${row.blockHash}`,
            new Date(`2026-01-01T00:${String(Number(row.blockNumber) % 60).padStart(2, '0')}:00Z`),
          ]),
        ),
      resultKey: (blockNumber: string, blockHash: string) => `${blockNumber}:${blockHash}`,
    };

    return applier;
  }

  async function deriveBatches(
    applier: AaveVoteProjectionApplier,
    repo: ArchiveActorResolutionRepository,
    eventTypes: readonly (typeof applier.eventTypes)[number][],
  ): Promise<void> {
    const rows = await repo.findDerivableBy(eventTypes, 100);
    const batches = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.dao_source_id}:${row.chain_id}:${row.event_type}`;
      const batch = batches.get(key);
      if (batch === undefined) {
        batches.set(key, [row]);
      } else {
        batch.push(row);
      }
    }

    for (const batch of batches.values()) {
      await applier.applyBatch(batch);
    }
  }

  async function insertProposal(sourceId: string, title: string): Promise<{ id: string }> {
    const proposal = await pgDb
      .insertInto('proposal')
      .values({
        dao_id: daoId,
        source_type: GOVERNANCE_SOURCE_TYPE,
        source_id: sourceId,
        proposer_actor_id: proposerActorId,
        title,
        description: 'desc',
        description_hash: sourceId.padStart(64, '0'),
        binding: true,
        voting_starts_at: null,
        voting_ends_at: null,
        voting_starts_block: '10',
        voting_ends_block: '20',
        voting_power_block: '10',
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
        snapshot_block_hash: null,
        snapshot_block_number_l1: null,
        creation_block: '10',
        last_reconcile_check_block: null,
      })
      .execute();

    return proposal;
  }

  async function insertFixtureArchiveRow(daoSourceId: string, fixture: FixtureLog): Promise<void> {
    const rawLog = toRawLog(fixture);
    const decoded = decodeAaveVotingMachineLog(rawLog, VOTING_MACHINE_SOURCE_TYPE);

    await chDb
      .insertInto('archive_event_aave_voting_machine')
      .values({
        dao_source_id: daoSourceId,
        chain_id: fixture.chainId,
        block_number: fixture.blockNumber,
        block_hash: fixture.blockHash,
        tx_hash: fixture.txHash,
        log_index: fixture.logIndex,
        event_type: decoded.type,
        payload: JSON.stringify(decoded.payload),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_aave_voting_machine'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: VOTING_MACHINE_SOURCE_TYPE,
        dao_source_id: daoSourceId,
        chain_id: fixture.chainId,
        block_number: fixture.blockNumber,
        block_hash: fixture.blockHash,
        tx_hash: fixture.txHash,
        log_index: fixture.logIndex,
        event_type: decoded.type,
        received_at: new Date('2026-01-01T00:00:00Z'),
        derivation_actor_resolved_at: new Date('2026-01-01T00:00:01Z'),
        derived_at: null,
      })
      .execute();
  }

  async function insertSyntheticVoteArchive(args: {
    daoSourceId: string;
    chainId: string;
    blockNumber: string;
    blockHash: string;
    txHash: string;
    logIndex: number;
    receivedAt?: Date;
    payload: {
      proposalId: string;
      voter: string;
      support: boolean;
      votingPower: string;
    };
  }): Promise<void> {
    await chDb
      .insertInto('archive_event_aave_voting_machine')
      .values({
        dao_source_id: args.daoSourceId,
        chain_id: args.chainId,
        block_number: args.blockNumber,
        block_hash: args.blockHash,
        tx_hash: args.txHash,
        log_index: args.logIndex,
        event_type: 'VoteEmitted',
        payload: JSON.stringify(args.payload),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_aave_voting_machine'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: VOTING_MACHINE_SOURCE_TYPE,
        dao_source_id: args.daoSourceId,
        chain_id: args.chainId,
        block_number: args.blockNumber,
        block_hash: args.blockHash,
        tx_hash: args.txHash,
        log_index: args.logIndex,
        event_type: 'VoteEmitted',
        received_at: args.receivedAt ?? new Date('2026-01-01T00:00:00Z'),
        derivation_actor_resolved_at: new Date('2026-01-01T00:00:01Z'),
        derived_at: null,
      })
      .execute();
  }

  async function expectDlqRows(txHash: string, expectedCount: number): Promise<void> {
    const rows = await pgDb
      .selectFrom('ingestion_dlq')
      .selectAll()
      .where('archive_tx_hash', '=', txHash)
      .execute();
    expect(rows).toHaveLength(expectedCount);
  }
});

function createMetricsCapture(): MetricsCapture {
  return { processed: [], stitchPending: [] };
}
