import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import {
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  chDb,
  DlqRepository,
  pgDb,
  ProposalRepository,
} from '@libs/db';
import {
  type AavePayloadProjectionMetrics,
  AaveGovernanceArchivePayloadRepository,
  AaveGovernanceProjectionApplier,
  AavePayloadReconcileRepository,
  AavePayloadStateReconciler,
  AavePayloadStitchApplier,
  AavePayloadsControllerArchivePayloadRepository,
  AaveProposalRepository,
  decodeAavePayloadsControllerLog,
  PAYLOAD_STATE_INTERFACE,
} from '@sources/aave';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const GOVERNANCE_SOURCE_TYPE = 'aave_governance_v3';
const PAYLOADS_CONTROLLER_SOURCE_TYPE = 'aave_payloads_controller';
const MAINNET_CHAIN_ID = '0x1';
const BASE_CHAIN_ID = '0xa';
const ARBITRUM_CHAIN_ID = '0xa4b1';
const UNINDEXED_CHAIN_ID = '0x1234';

const MAINNET_GOVERNANCE_ADDRESS = '0x9aee0b04504cef83a65ac3f0e838d0593bcb2bc7';
const BASE_CONTROLLER_ADDRESS = '0x0e1a3af1f9cc76a62ed31ededca291e63632e7c4';
const ARBITRUM_CONTROLLER_ADDRESS = '0x89644ca1bb8064760312ae4f03ea41b05da3637c';
const UNINDEXED_CONTROLLER_ADDRESS = '0x7777777777777777777777777777777777777777';

const PROPOSAL_SOURCE_ID = '132';
const EXECUTED_PAYLOAD_ID = '80';
const EXPIRED_PAYLOAD_ID = '81';
const UNINDEXED_PAYLOAD_ID = '82';

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

type StitchMetricsCapture = {
  processed: Array<{ event_type: string; outcome: string; reason: string | null }>;
  stitchPending: Array<{
    seconds: number;
    labels: { target_chain_id: string; event_type: string };
  }>;
  stitchUnmatched: Array<{
    count: number;
    labels: { target_chain_id: string; event_type: string };
  }>;
};

function fixtureLog(name: string): FixtureLog {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', 'logs', name), 'utf8')) as FixtureLog;
}

function numberedHash(n: number): string {
  return '0x' + n.toString(16).padStart(64, '0');
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

describeIf('aave payload resilience integration', () => {
  let archive: ArchiveDerivationRepository;
  let actorResolution: ArchiveActorResolutionRepository;
  let governancePayloads: AaveGovernanceArchivePayloadRepository;
  let payloadsControllerPayloads: AavePayloadsControllerArchivePayloadRepository;
  let proposals: ProposalRepository;
  let aaveProposals: AaveProposalRepository;
  let payloadReconcileRepo: AavePayloadReconcileRepository;
  let dlq: DlqRepository;
  let governanceDaoSourceId = '';
  let baseDaoSourceId = '';
  let arbitrumDaoSourceId = '';
  let daoId = '';
  let proposalId = '';

  beforeAll(async () => {
    archive = new ArchiveDerivationRepository(pgDb);
    actorResolution = new ArchiveActorResolutionRepository(pgDb);
    governancePayloads = new AaveGovernanceArchivePayloadRepository(chDb);
    payloadsControllerPayloads = new AavePayloadsControllerArchivePayloadRepository(chDb);
    proposals = new ProposalRepository(pgDb);
    aaveProposals = new AaveProposalRepository(pgDb);
    payloadReconcileRepo = new AavePayloadReconcileRepository(pgDb);
    dlq = new DlqRepository(pgDb);

    await pgDb
      .insertInto('source_type')
      .values([{ value: GOVERNANCE_SOURCE_TYPE }, { value: PAYLOADS_CONTROLLER_SOURCE_TYPE }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const daoRow = await pgDb
      .insertInto('dao')
      .values({
        slug: `aave-payload-resilience-int-${Date.now()}`,
        name: 'Aave Payload Resilience Integration',
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

    governanceDaoSourceId = (
      await pgDb
        .insertInto('dao_source')
        .values({
          dao_id: daoId,
          source_type: GOVERNANCE_SOURCE_TYPE,
          chain_id: MAINNET_CHAIN_ID,
          source_config: { governance_address: MAINNET_GOVERNANCE_ADDRESS },
          active_from_block: null,
          active_to_block: null,
          backfill_started_at_block: null,
          backfill_head_block: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    baseDaoSourceId = (
      await pgDb
        .insertInto('dao_source')
        .values({
          dao_id: daoId,
          source_type: PAYLOADS_CONTROLLER_SOURCE_TYPE,
          chain_id: BASE_CHAIN_ID,
          source_config: { payloads_controller_address: BASE_CONTROLLER_ADDRESS },
          active_from_block: null,
          active_to_block: null,
          backfill_started_at_block: null,
          backfill_head_block: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    arbitrumDaoSourceId = (
      await pgDb
        .insertInto('dao_source')
        .values({
          dao_id: daoId,
          source_type: PAYLOADS_CONTROLLER_SOURCE_TYPE,
          chain_id: ARBITRUM_CHAIN_ID,
          source_config: { payloads_controller_address: ARBITRUM_CONTROLLER_ADDRESS },
          active_from_block: null,
          active_to_block: null,
          backfill_started_at_block: null,
          backfill_head_block: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, proposal, actor, ingestion_dlq, ingestion_dlq_resolved RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`TRUNCATE aave_proposal_metadata, aave_proposal_payload, proposal_action RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aave_governance_v3 DELETE WHERE chain_id = ${MAINNET_CHAIN_ID}`.execute(
      chDb,
    );
    await sql`ALTER TABLE archive_event_aave_payloads_controller DELETE WHERE chain_id IN (${BASE_CHAIN_ID}, ${ARBITRUM_CHAIN_ID}, ${UNINDEXED_CHAIN_ID})`.execute(
      chDb,
    );
    proposalId = '';
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, proposal, actor, ingestion_dlq, ingestion_dlq_resolved RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`TRUNCATE aave_proposal_metadata, aave_proposal_payload, proposal_action RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aave_governance_v3 DELETE WHERE chain_id = ${MAINNET_CHAIN_ID}`.execute(
      chDb,
    );
    await sql`ALTER TABLE archive_event_aave_payloads_controller DELETE WHERE chain_id IN (${BASE_CHAIN_ID}, ${ARBITRUM_CHAIN_ID}, ${UNINDEXED_CHAIN_ID})`.execute(
      chDb,
    );
  });

  it('keeps expiry row-scoped across executed, expired, and unindexed payloads on three destination chains', async () => {
    await seedProposalAndPayloadDeclarations();

    const stitchMetrics = createStitchMetricsCapture();
    const applier = createPayloadApplier(stitchMetrics);

    const baseCreatedFixture = fixtureLog('payload-created.json');
    await insertFixturePayloadArchive(baseDaoSourceId, baseCreatedFixture);
    await insertSyntheticPayloadArchive({
      daoSourceId: baseDaoSourceId,
      chainId: BASE_CHAIN_ID,
      blockNumber: '20412311',
      blockHash: numberedHash(3001),
      txHash: numberedHash(3002),
      logIndex: 1,
      eventType: 'PayloadExecuted',
      payload: { payloadId: EXECUTED_PAYLOAD_ID },
      receivedAt: new Date('2026-01-02T00:00:00Z'),
    });
    await insertSyntheticPayloadArchive({
      daoSourceId: arbitrumDaoSourceId,
      chainId: ARBITRUM_CHAIN_ID,
      blockNumber: '130388803',
      blockHash: numberedHash(3003),
      txHash: numberedHash(3004),
      logIndex: 2,
      eventType: 'PayloadCreated',
      payload: {
        payloadId: EXPIRED_PAYLOAD_ID,
        creator: '0x' + 'bc'.repeat(20),
        maximumAccessLevelRequired: 1,
        actions: [
          {
            target: '0x' + 'cd'.repeat(20),
            withDelegateCall: false,
            accessLevel: 0,
            value: '5',
            signature: '',
            callData: '0x1234',
          },
        ],
      },
      receivedAt: new Date('2026-01-02T00:01:00Z'),
    });

    await derivePayloadBatches(applier, ['PayloadCreated']);
    await derivePayloadBatches(applier, ['PayloadExecuted']);

    const payloadsBefore = await selectPayloadRows();
    const executedBefore = payloadsBefore.find((row) => row.payload_id === EXECUTED_PAYLOAD_ID);
    const expiredBefore = payloadsBefore.find((row) => row.payload_id === EXPIRED_PAYLOAD_ID);
    const unindexedBefore = payloadsBefore.find((row) => row.payload_id === UNINDEXED_PAYLOAD_ID);
    expect(executedBefore).toMatchObject({
      status: 'executed',
      target_chain_id: BASE_CHAIN_ID,
      unindexed_target_chain: false,
      executed_at_destination: new Date('2026-01-01T00:11:00Z'),
    });
    expect(expiredBefore).toMatchObject({
      status: 'created',
      target_chain_id: ARBITRUM_CHAIN_ID,
      unindexed_target_chain: false,
      executed_at_destination: null,
    });
    expect(unindexedBefore).toMatchObject({
      status: 'declared',
      target_chain_id: UNINDEXED_CHAIN_ID,
      unindexed_target_chain: true,
      executed_at_destination: null,
    });

    const proposalBefore = await pgDb
      .selectFrom('proposal')
      .selectAll()
      .where('id', '=', proposalId)
      .executeTakeFirstOrThrow();

    const reconciler = new AavePayloadStateReconciler(silentLogger, ['aave_payloads_controller']);
    await reconciler.reconcileRow({
      row: {
        id: expiredBefore!.id,
        source_id: expiredBefore!.payload_id,
        source_type: 'aave_payloads_controller',
        chain_id: expiredBefore!.target_chain_id,
        payloads_controller_address: expiredBefore!.payloads_controller_address,
        payload_id: expiredBefore!.payload_id,
        status: 'created',
      },
      proposals: payloadReconcileRepo,
      confirmedThreshold: 5000n,
      confirmedThresholdTag: '0x1388',
      chainCtx: {
        client: {
          send: vi.fn(async () =>
            PAYLOAD_STATE_INTERFACE.encodeFunctionResult('getPayloadById', [
              ['0x' + '11'.repeat(20), 1n, 5n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, []],
            ]),
          ),
        },
        chainCfg: { chainId: ARBITRUM_CHAIN_ID },
      } as never,
    });

    const proposalAfter = await pgDb
      .selectFrom('proposal')
      .selectAll()
      .where('id', '=', proposalId)
      .executeTakeFirstOrThrow();
    const payloadsAfter = await selectPayloadRows();
    const executedAfter = payloadsAfter.find((row) => row.payload_id === EXECUTED_PAYLOAD_ID);
    const expiredAfter = payloadsAfter.find((row) => row.payload_id === EXPIRED_PAYLOAD_ID);
    const unindexedAfter = payloadsAfter.find((row) => row.payload_id === UNINDEXED_PAYLOAD_ID);

    expect(proposalAfter).toEqual(proposalBefore);
    expect(executedAfter).toEqual(executedBefore);
    expect(unindexedAfter).toEqual(unindexedBefore);
    expect(expiredAfter).toMatchObject({
      id: expiredBefore!.id,
      status: 'expired',
      target_chain_id: ARBITRUM_CHAIN_ID,
      unindexed_target_chain: false,
    });
    expect(expiredAfter?.last_reconcile_check_block).toBe('5000');

    const actions = await pgDb
      .selectFrom('proposal_action')
      .select(['payload_index', 'target_chain_id', 'function_signature', 'calldata'])
      .where('proposal_id', '=', proposalId)
      .orderBy('payload_index', 'asc')
      .orderBy('action_index', 'asc')
      .execute();
    expect(actions).toEqual([
      {
        payload_index: 0,
        target_chain_id: BASE_CHAIN_ID,
        function_signature: 'execute()',
        calldata: '0x',
      },
      {
        payload_index: 1,
        target_chain_id: ARBITRUM_CHAIN_ID,
        function_signature: null,
        calldata: '0x1234',
      },
    ]);

    expect(stitchMetrics.stitchUnmatched).toContainEqual({
      count: 0,
      labels: { target_chain_id: BASE_CHAIN_ID, event_type: 'PayloadCreated' },
    });
    expect(await pgDb.selectFrom('ingestion_dlq').selectAll().execute()).toHaveLength(0);
  }, 30_000);

  it('keeps the first unindexed flag on re-derive, but payload events still advance after chain registration', async () => {
    await seedProposalAndPayloadDeclarations();

    const declaredBefore = await pgDb
      .selectFrom('aave_proposal_payload')
      .select(['status', 'unindexed_target_chain'])
      .where('proposal_id', '=', proposalId)
      .where('payload_id', '=', UNINDEXED_PAYLOAD_ID)
      .executeTakeFirstOrThrow();
    expect(declaredBefore).toEqual({
      status: 'declared',
      unindexed_target_chain: true,
    });

    const unindexedPayloadTxHash = numberedHash(2004);

    await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoId,
        source_type: PAYLOADS_CONTROLLER_SOURCE_TYPE,
        chain_id: UNINDEXED_CHAIN_ID,
        source_config: { payloads_controller_address: UNINDEXED_CONTROLLER_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .execute();

    await pgDb
      .updateTable('archive_event')
      .set({ derived_at: null })
      .where('tx_hash', '=', unindexedPayloadTxHash)
      .execute();

    const governanceApplier = createGovernanceApplier();
    await governanceApplier.applyBatch(
      await actorResolution.findDerivableBy(governanceApplier.eventTypes, 20),
    );

    const afterRederive = await pgDb
      .selectFrom('aave_proposal_payload')
      .select(['status', 'unindexed_target_chain'])
      .where('proposal_id', '=', proposalId)
      .where('payload_id', '=', UNINDEXED_PAYLOAD_ID)
      .executeTakeFirstOrThrow();
    expect(afterRederive).toEqual({
      status: 'declared',
      unindexed_target_chain: true,
    });

    const nowIndexedDaoSourceId = await pgDb
      .selectFrom('dao_source')
      .select(['id'])
      .where('dao_id', '=', daoId)
      .where('source_type', '=', PAYLOADS_CONTROLLER_SOURCE_TYPE)
      .where('chain_id', '=', UNINDEXED_CHAIN_ID)
      .executeTakeFirstOrThrow();

    await insertSyntheticPayloadArchive({
      daoSourceId: nowIndexedDaoSourceId.id,
      chainId: UNINDEXED_CHAIN_ID,
      blockNumber: '12345',
      blockHash: numberedHash(4001),
      txHash: numberedHash(4002),
      logIndex: 4,
      eventType: 'PayloadCreated',
      payload: {
        payloadId: UNINDEXED_PAYLOAD_ID,
        creator: '0x' + 'de'.repeat(20),
        maximumAccessLevelRequired: 1,
        actions: [
          {
            target: '0x' + 'ef'.repeat(20),
            withDelegateCall: false,
            accessLevel: 0,
            value: '7',
            signature: '',
            callData: '0xabcd',
          },
        ],
      },
      receivedAt: new Date('2026-01-03T00:00:00Z'),
    });

    const stitchMetrics = createStitchMetricsCapture();
    const payloadApplier = createPayloadApplier(stitchMetrics);
    await derivePayloadBatches(payloadApplier, ['PayloadCreated']);

    const afterCreate = await pgDb
      .selectFrom('aave_proposal_payload')
      .select(['status', 'unindexed_target_chain'])
      .where('proposal_id', '=', proposalId)
      .where('payload_id', '=', UNINDEXED_PAYLOAD_ID)
      .executeTakeFirstOrThrow();
    expect(afterCreate).toEqual({
      status: 'created',
      unindexed_target_chain: true,
    });
  }, 30_000);

  async function seedProposalAndPayloadDeclarations(): Promise<void> {
    await insertGovernanceArchiveEvent({
      eventType: 'ProposalCreated',
      blockNumber: '100',
      logIndex: 0,
      txHash: numberedHash(2000),
      blockHash: numberedHash(2100),
      payload: {
        proposalId: PROPOSAL_SOURCE_ID,
        creator: '0x1111111111111111111111111111111111111111',
        accessLevel: 2,
        ipfsHash: '0x' + '12'.repeat(32),
      },
    });
    await insertGovernanceArchiveEvent({
      eventType: 'PayloadSent',
      blockNumber: '101',
      logIndex: 1,
      txHash: numberedHash(2001),
      blockHash: numberedHash(2101),
      payload: {
        proposalId: PROPOSAL_SOURCE_ID,
        payloadId: EXECUTED_PAYLOAD_ID,
        payloadsController: BASE_CONTROLLER_ADDRESS,
        chainId: BASE_CHAIN_ID,
        payloadNumberOnProposal: '0',
        numberOfPayloadsOnProposal: '3',
      },
    });
    await insertGovernanceArchiveEvent({
      eventType: 'PayloadSent',
      blockNumber: '102',
      logIndex: 2,
      txHash: numberedHash(2002),
      blockHash: numberedHash(2102),
      payload: {
        proposalId: PROPOSAL_SOURCE_ID,
        payloadId: EXPIRED_PAYLOAD_ID,
        payloadsController: ARBITRUM_CONTROLLER_ADDRESS,
        chainId: ARBITRUM_CHAIN_ID,
        payloadNumberOnProposal: '1',
        numberOfPayloadsOnProposal: '3',
      },
    });
    await insertGovernanceArchiveEvent({
      eventType: 'PayloadSent',
      blockNumber: '103',
      logIndex: 3,
      txHash: numberedHash(2004),
      blockHash: numberedHash(2104),
      payload: {
        proposalId: PROPOSAL_SOURCE_ID,
        payloadId: UNINDEXED_PAYLOAD_ID,
        payloadsController: UNINDEXED_CONTROLLER_ADDRESS,
        chainId: UNINDEXED_CHAIN_ID,
        payloadNumberOnProposal: '2',
        numberOfPayloadsOnProposal: '3',
      },
    });

    const governanceApplier = createGovernanceApplier();
    await governanceApplier.applyBatch(
      await actorResolution.findDerivableBy(governanceApplier.eventTypes, 20),
    );

    proposalId = (
      await pgDb
        .selectFrom('proposal')
        .select(['id'])
        .where('source_type', '=', GOVERNANCE_SOURCE_TYPE)
        .where('source_id', '=', PROPOSAL_SOURCE_ID)
        .executeTakeFirstOrThrow()
    ).id;
  }

  function createGovernanceApplier(): AaveGovernanceProjectionApplier {
    return new AaveGovernanceProjectionApplier({
      pgDb,
      archive,
      dlq,
      payloads: governancePayloads,
      ipfsFetcher: {
        fetchTitleDescription: vi.fn().mockResolvedValue({
          kind: 'resolved',
          title: 'Proposal 132',
          description: 'Payload resilience integration',
        }),
      } as never,
      metrics: {
        batchLookupSeconds: () => undefined,
        processed: () => undefined,
        ipfsTitleFetch: () => undefined,
      },
      logger: silentLogger,
    });
  }

  function createPayloadApplier(metrics: StitchMetricsCapture): AavePayloadStitchApplier {
    const applier = new AavePayloadStitchApplier({
      pgDb,
      archive,
      dlq,
      payloads: payloadsControllerPayloads,
      proposals,
      aaveProposals,
      metrics: {
        batchLookupSeconds: () => undefined,
        stitchPendingSeconds: (seconds, labels) => {
          metrics.stitchPending.push({ seconds, labels });
        },
        stitchUnmatchedPayloads: (count, labels) => {
          metrics.stitchUnmatched.push({ count, labels });
        },
        processed: (labels) => {
          metrics.processed.push(labels);
        },
      } satisfies AavePayloadProjectionMetrics,
      registry: {
        peek: (chainId: string) =>
          [BASE_CHAIN_ID, ARBITRUM_CHAIN_ID, UNINDEXED_CHAIN_ID].includes(chainId)
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

  async function derivePayloadBatches(
    applier: AavePayloadStitchApplier,
    eventTypes: readonly (typeof applier.eventTypes)[number][],
  ): Promise<void> {
    const rows = await actorResolution.findDerivableBy(eventTypes, 100);
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

  async function selectPayloadRows() {
    return pgDb
      .selectFrom('aave_proposal_payload')
      .selectAll()
      .where('proposal_id', '=', proposalId)
      .orderBy('payload_index', 'asc')
      .execute();
  }

  async function insertGovernanceArchiveEvent(args: {
    eventType: 'ProposalCreated' | 'PayloadSent';
    blockNumber: string;
    logIndex: number;
    txHash: string;
    blockHash: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await chDb
      .insertInto('archive_event_aave_governance_v3')
      .values({
        dao_source_id: governanceDaoSourceId,
        chain_id: MAINNET_CHAIN_ID,
        block_number: args.blockNumber,
        block_hash: args.blockHash,
        tx_hash: args.txHash,
        log_index: args.logIndex,
        event_type: args.eventType,
        payload: JSON.stringify(args.payload),
        received_at: new Date(`2026-01-01T00:00:0${args.logIndex}Z`),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_aave_governance_v3'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: GOVERNANCE_SOURCE_TYPE,
        dao_source_id: governanceDaoSourceId,
        chain_id: MAINNET_CHAIN_ID,
        block_number: args.blockNumber,
        block_hash: args.blockHash,
        tx_hash: args.txHash,
        log_index: args.logIndex,
        event_type: args.eventType,
        received_at: new Date(`2026-01-01T00:00:0${args.logIndex}Z`),
        derivation_actor_resolved_at: new Date(`2026-01-01T00:00:1${args.logIndex}Z`),
        derived_at: null,
      })
      .execute();
  }

  async function insertFixturePayloadArchive(
    daoSourceId: string,
    fixture: FixtureLog,
  ): Promise<void> {
    const rawLog = toRawLog(fixture);
    const decoded = decodeAavePayloadsControllerLog(rawLog, PAYLOADS_CONTROLLER_SOURCE_TYPE);

    await chDb
      .insertInto('archive_event_aave_payloads_controller')
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
        ReturnType<typeof chDb.insertInto<'archive_event_aave_payloads_controller'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: PAYLOADS_CONTROLLER_SOURCE_TYPE,
        dao_source_id: daoSourceId,
        chain_id: fixture.chainId,
        block_number: fixture.blockNumber,
        block_hash: fixture.blockHash,
        tx_hash: fixture.txHash,
        log_index: fixture.logIndex,
        event_type: decoded.type,
        received_at: new Date('2026-01-02T00:00:00Z'),
        derivation_actor_resolved_at: new Date('2026-01-02T00:00:01Z'),
        derived_at: null,
      })
      .execute();
  }

  async function insertSyntheticPayloadArchive(args: {
    daoSourceId: string;
    chainId: string;
    blockNumber: string;
    blockHash: string;
    txHash: string;
    logIndex: number;
    eventType: 'PayloadCreated' | 'PayloadExecuted';
    payload:
      | {
          payloadId: string;
          creator: string;
          maximumAccessLevelRequired: number;
          actions: Array<{
            target: string;
            withDelegateCall: boolean;
            accessLevel: number;
            value: string;
            signature: string;
            callData: string;
          }>;
        }
      | {
          payloadId: string;
        };
    receivedAt: Date;
  }): Promise<void> {
    await chDb
      .insertInto('archive_event_aave_payloads_controller')
      .values({
        dao_source_id: args.daoSourceId,
        chain_id: args.chainId,
        block_number: args.blockNumber,
        block_hash: args.blockHash,
        tx_hash: args.txHash,
        log_index: args.logIndex,
        event_type: args.eventType,
        payload: JSON.stringify(args.payload),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_aave_payloads_controller'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: PAYLOADS_CONTROLLER_SOURCE_TYPE,
        dao_source_id: args.daoSourceId,
        chain_id: args.chainId,
        block_number: args.blockNumber,
        block_hash: args.blockHash,
        tx_hash: args.txHash,
        log_index: args.logIndex,
        event_type: args.eventType,
        received_at: args.receivedAt,
        derivation_actor_resolved_at: new Date(args.receivedAt.getTime() + 1_000),
        derived_at: null,
      })
      .execute();
  }
});

function createStitchMetricsCapture(): StitchMetricsCapture {
  return { processed: [], stitchPending: [], stitchUnmatched: [] };
}
