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
} from '@libs/db';
import { decodeAavePayloadsControllerLog } from '../src/payloads-controller/abi/decoder';
import { AavePayloadStitchApplier } from '../src/payloads-controller/domain/payload-stitch-applier';
import { AavePayloadsControllerArchivePayloadRepository } from '../src/payloads-controller/persistence/archive-payload-repository';
import { AaveProposalRepository } from '../src/persistence/aave-proposal-repository';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const GOVERNANCE_SOURCE_TYPE = 'aave_governance_v3';
const PAYLOADS_CONTROLLER_SOURCE_TYPE = 'aave_payloads_controller';
const BASE_CHAIN_ID = '0xa';
const MAINNET_CHAIN_ID = '0x1';
const BASE_CONTROLLER_ADDRESS = '0x0e1a3af1f9cc76a62ed31ededca291e63632e7c4';
const MAINNET_CONTROLLER_ADDRESS = '0xdabad81af85554e9ae636395611c58f7ec1aaec5';
const PAYLOAD_SOURCE_ID = '42';
const HOLD_SOURCE_ID = '99';
const PAYLOAD_ID = '80';
const HOLD_PAYLOAD_ID = '81';

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

describeIf('aave payload stitch integration', () => {
  let archive: ArchiveDerivationRepository;
  let actorResolution: ArchiveActorResolutionRepository;
  let payloads: AavePayloadsControllerArchivePayloadRepository;
  let proposals: ProposalRepository;
  let aaveProposals: AaveProposalRepository;
  let dlq: DlqRepository;
  let governanceDaoSourceId = '';
  let baseDaoSourceId = '';
  let mainnetDaoSourceId = '';
  let daoId = '';
  let proposerActorId = '';

  beforeAll(async () => {
    archive = new ArchiveDerivationRepository(pgDb);
    actorResolution = new ArchiveActorResolutionRepository(pgDb);
    payloads = new AavePayloadsControllerArchivePayloadRepository(chDb);
    proposals = new ProposalRepository(pgDb);
    aaveProposals = new AaveProposalRepository(pgDb);
    dlq = new DlqRepository(pgDb);

    await pgDb
      .insertInto('source_type')
      .values([{ value: GOVERNANCE_SOURCE_TYPE }, { value: PAYLOADS_CONTROLLER_SOURCE_TYPE }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const daoRow = await pgDb
      .insertInto('dao')
      .values({
        slug: `aave-payload-stitch-int-${Date.now()}`,
        name: 'Aave Payload Stitch Integration',
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
          source_config: { governance_address: '0x' + '10'.repeat(20) },
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

    mainnetDaoSourceId = (
      await pgDb
        .insertInto('dao_source')
        .values({
          dao_id: daoId,
          source_type: PAYLOADS_CONTROLLER_SOURCE_TYPE,
          chain_id: MAINNET_CHAIN_ID,
          source_config: { payloads_controller_address: MAINNET_CONTROLLER_ADDRESS },
          active_from_block: null,
          active_to_block: null,
          backfill_started_at_block: null,
          backfill_head_block: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    proposerActorId = (
      await pgDb
        .insertInto('actor')
        .values({
          primary_address: '0x' + 'aa'.repeat(20),
          updated_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    void governanceDaoSourceId;
    void mainnetDaoSourceId;
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, proposal, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`TRUNCATE aave_proposal_metadata, aave_proposal_payload, proposal_action RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aave_payloads_controller DELETE WHERE chain_id IN (${BASE_CHAIN_ID}, ${MAINNET_CHAIN_ID})`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, proposal, actor, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`TRUNCATE aave_proposal_metadata, aave_proposal_payload, proposal_action RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aave_payloads_controller DELETE WHERE chain_id IN (${BASE_CHAIN_ID}, ${MAINNET_CHAIN_ID})`.execute(
      chDb,
    );
  });

  it('stitches created and executed payload rows, writes actions, and holds until the declared payload appears', async () => {
    const metrics = createMetricsCapture();
    const applier = createApplier(metrics);

    const stitchedProposal = await insertProposal(PAYLOAD_SOURCE_ID, 'Payload stitch proposal');
    await aaveProposals.insertDeclaredPayload({
      proposal_id: stitchedProposal.id,
      payload_index: 0,
      target_chain_id: BASE_CHAIN_ID,
      payloads_controller_address: BASE_CONTROLLER_ADDRESS,
      payload_id: PAYLOAD_ID,
      status: 'declared',
      executed_at_destination: null,
      bridge_message_id: null,
    });

    const createdFixture = fixtureLog('payload-created.json');
    await insertFixtureArchiveRow(baseDaoSourceId, createdFixture);
    await insertSyntheticPayloadArchive({
      daoSourceId: baseDaoSourceId,
      chainId: BASE_CHAIN_ID,
      blockNumber: '20412311',
      blockHash: '0x' + '91'.padStart(64, '0'),
      txHash: '0x' + '92'.padStart(64, '0'),
      logIndex: 642,
      eventType: 'PayloadExecuted',
      payload: {
        payloadId: PAYLOAD_ID,
      },
    });

    await deriveBatches(applier, actorResolution, ['PayloadCreated']);
    await deriveBatches(applier, actorResolution, ['PayloadExecuted']);

    const payloadRow = await pgDb
      .selectFrom('aave_proposal_payload')
      .select(['status', 'executed_at_destination'])
      .where('proposal_id', '=', stitchedProposal.id)
      .where('payload_index', '=', 0)
      .executeTakeFirstOrThrow();
    expect(payloadRow.status).toBe('executed');
    expect(payloadRow.executed_at_destination).toEqual(new Date('2026-01-01T00:11:00Z'));

    const proposalActions = await pgDb
      .selectFrom('proposal_action')
      .select([
        'proposal_id',
        'payload_index',
        'action_index',
        'target_chain_id',
        'target_address',
        'value_wei',
        'function_signature',
        'calldata',
      ])
      .where('proposal_id', '=', stitchedProposal.id)
      .orderBy('action_index', 'asc')
      .execute();
    expect(proposalActions).toEqual([
      {
        proposal_id: stitchedProposal.id,
        payload_index: 0,
        action_index: 0,
        target_chain_id: BASE_CHAIN_ID,
        target_address: '0xc09aa853780cf5c2265560d2f0d9208522c71d36',
        value_wei: '0',
        function_signature: 'execute()',
        calldata: '0x',
      },
    ]);

    const derivedRows = await pgDb
      .selectFrom('archive_event')
      .select(['event_type', 'derived_at'])
      .where('tx_hash', 'in', [createdFixture.txHash, '0x' + '92'.padStart(64, '0')])
      .orderBy('event_type', 'asc')
      .execute();
    expect(derivedRows).toEqual([
      { event_type: 'PayloadCreated', derived_at: expect.any(Date) },
      { event_type: 'PayloadExecuted', derived_at: expect.any(Date) },
    ]);

    const heldCreatedTxHash = '0x' + '81'.padStart(64, '0');
    await insertSyntheticPayloadArchive({
      daoSourceId: baseDaoSourceId,
      chainId: BASE_CHAIN_ID,
      blockNumber: '138147944',
      blockHash: '0x' + '82'.padStart(64, '0'),
      txHash: heldCreatedTxHash,
      logIndex: 641,
      eventType: 'PayloadCreated',
      receivedAt: new Date('2026-01-02T00:00:00Z'),
      payload: {
        payloadId: HOLD_PAYLOAD_ID,
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
    });

    const nowMs = Date.now;
    Date.now = () => new Date('2026-01-02T00:03:00Z').getTime();
    try {
      await deriveBatches(applier, actorResolution, ['PayloadCreated']);
    } finally {
      Date.now = nowMs;
    }

    const heldArchiveRow = await pgDb
      .selectFrom('archive_event')
      .select(['derived_at'])
      .where('tx_hash', '=', heldCreatedTxHash)
      .executeTakeFirstOrThrow();
    expect(heldArchiveRow.derived_at).toBeNull();
    expect(
      metrics.processed.some(
        (call) =>
          call.event_type === 'PayloadCreated' &&
          call.outcome === 'held' &&
          call.reason === 'no_declared_payload',
      ),
    ).toBe(true);
    expect(
      metrics.stitchPending.some(
        (entry) =>
          entry.seconds === 180 &&
          entry.labels.target_chain_id === BASE_CHAIN_ID &&
          entry.labels.event_type === 'PayloadCreated',
      ),
    ).toBe(true);
    expect(metrics.stitchUnmatched).toContainEqual({
      count: 1,
      labels: { target_chain_id: BASE_CHAIN_ID, event_type: 'PayloadCreated' },
    });
    await expectDlqRows(heldCreatedTxHash, 0);

    const heldProposal = await insertProposal(HOLD_SOURCE_ID, 'Held payload proposal');
    await aaveProposals.insertDeclaredPayload({
      proposal_id: heldProposal.id,
      payload_index: 1,
      target_chain_id: BASE_CHAIN_ID,
      payloads_controller_address: BASE_CONTROLLER_ADDRESS,
      payload_id: HOLD_PAYLOAD_ID,
      status: 'declared',
      executed_at_destination: null,
      bridge_message_id: null,
    });

    await deriveBatches(applier, actorResolution, ['PayloadCreated']);

    const resolvedHeldRow = await pgDb
      .selectFrom('archive_event')
      .select(['derived_at'])
      .where('tx_hash', '=', heldCreatedTxHash)
      .executeTakeFirstOrThrow();
    expect(resolvedHeldRow.derived_at).not.toBeNull();
    expect(
      metrics.stitchPending.some(
        (entry) =>
          entry.seconds === 0 &&
          entry.labels.target_chain_id === BASE_CHAIN_ID &&
          entry.labels.event_type === 'PayloadCreated',
      ),
    ).toBe(true);
    expect(metrics.stitchUnmatched).toContainEqual({
      count: 0,
      labels: { target_chain_id: BASE_CHAIN_ID, event_type: 'PayloadCreated' },
    });

    const heldActions = await pgDb
      .selectFrom('proposal_action')
      .select([
        'payload_index',
        'action_index',
        'target_chain_id',
        'function_signature',
        'calldata',
      ])
      .where('proposal_id', '=', heldProposal.id)
      .execute();
    expect(heldActions).toEqual([
      {
        payload_index: 1,
        action_index: 0,
        target_chain_id: BASE_CHAIN_ID,
        function_signature: null,
        calldata: '0x1234',
      },
    ]);
  }, 30_000);

  function createApplier(metrics: MetricsCapture): AavePayloadStitchApplier {
    const applier = new AavePayloadStitchApplier({
      pgDb,
      archive,
      dlq,
      payloads,
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
      },
      registry: {
        peek: (chainId: string) =>
          chainId === BASE_CHAIN_ID || chainId === MAINNET_CHAIN_ID
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
    applier: AavePayloadStitchApplier,
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
        received_at: new Date('2026-01-01T00:00:00Z'),
        derivation_actor_resolved_at: new Date('2026-01-01T00:00:01Z'),
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
    receivedAt?: Date;
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
  return { processed: [], stitchPending: [], stitchUnmatched: [] };
}
