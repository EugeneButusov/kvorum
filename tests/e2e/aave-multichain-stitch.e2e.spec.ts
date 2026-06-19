/**
 * Y2 — multi-chain Aave Governance v3 stitching acceptance gate (§3.5, AC #2, AC #6).
 *
 * Drives one synthetic proposal (ID 200, valid ABI-encoded fixtures) through the real
 * ingestion path (decode → ADR-041 archive write) and real derivation appliers, then
 * asserts the stitched state matches the fixture `expected.json` on every involved chain.
 *
 * Three scenarios:
 *  1. In-order — all events in arrival order → full stitch, both payloads correct.
 *  2. Out-of-order / held path — payload events arrive before `ProposalCreated` → held,
 *     then resolve once the governance events are derived.
 *  3. Lossy-execution (AC #6 gate) — Optimism `PayloadExecuted` omitted → that payload
 *     stays `queued`, Ethereum payload and proposal are unaffected.
 *
 * Block timestamps are injected via a fake `ChainContextRegistry` built from the
 * committed `block-headers.json` — no live RPC at test time.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger, type EventsListener, type LogEvent } from '@libs/chain';
import {
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  chDb,
  DlqRepository,
  pgDb,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
} from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import {
  AaveGovernanceArchivePayloadRepository,
  AaveGovernanceArchiveWriter,
  AaveGovernanceEventRepository,
  AaveGovernanceProjectionApplier,
  AaveIpfsTitleFetcher,
  AavePayloadsControllerArchivePayloadRepository,
  AavePayloadsControllerArchiveWriter,
  AavePayloadsControllerEventRepository,
  AavePayloadStitchApplier,
  AaveProposalRepository,
  AaveVotingMachineArchivePayloadRepository,
  AaveVotingMachineArchiveWriter,
  AaveVotingMachineEventRepository,
  AaveVoteProjectionApplier,
  makeAaveGovernanceIngesterListener,
  makeAavePayloadsControllerIngesterListener,
  makeAaveVotingMachineIngesterListener,
} from '@sources/aave';
import type { ArchiveWriteContext } from '@sources/core';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

// ── Fixture paths ─────────────────────────────────────────────────────────────
const FIXTURE_DIR = join(__dirname, 'fixtures', 'aave-multichain', 'proposal-200');

const SEED_DATE = new Date('2026-01-01T00:00:00.000Z');

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
type BlockHeaders = Record<string, Record<string, { hash: string; timestamp: number }>>;
type Expected = {
  proposal: { source_id: string; state: string; voting_chain_id: string };
  votes: Array<{ voter: string; support: boolean; voting_power: string }>;
  payloads: Array<{
    target_chain_id: string;
    status: string;
    executed_at_destination_block: string | null;
  }>;
};

function loadFixtureLogs(name: string): FixtureLog[] {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as FixtureLog[];
}
function loadBlockHeaders(): BlockHeaders {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, 'block-headers.json'), 'utf8')) as BlockHeaders;
}
function loadExpected(): Expected {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, 'expected.json'), 'utf8')) as Expected;
}
function toLogEvent(f: FixtureLog): LogEvent {
  return {
    chainId: f.chainId,
    blockNumber: f.blockNumber,
    blockHash: f.blockHash,
    txHash: f.txHash,
    logIndex: f.logIndex,
    address: f.address,
    topics: f.topics,
    data: f.data,
  };
}

// ── Seeded contract addresses (must match aave_002_seed.ts) ────────────────────
const GOV_ADDR = '0x9aee0b04504cef83a65ac3f0e838d0593bcb2bc7';
const VM_ADDR = '0x44c8b753229006a8047a05b90379a7e92185e97c';
const PC_ETH_ADDR = '0xdabad81af85554e9ae636395611c58f7ec1aaec5';
const PC_OP_ADDR = '0x0e1a3af1f9cc76a62ed31ededca291e63632e7c4';

const CHAIN_ETH = '0x1';
const CHAIN_POL = '0x89';
const CHAIN_OP = '0xa';

/** Build a fake ChainContextRegistry from the committed block-headers.json. */
function makeFakeRegistry(headers: BlockHeaders) {
  return {
    peek(chainId: string) {
      const chainHeaders = headers[chainId];
      if (chainHeaders == null) return undefined;
      return {
        client: {
          send: (_method: string, params: unknown[]) => {
            // Called as eth_getBlockByNumber(blockHex, false)
            const blockHex = (params as [string])[0];
            const blockNum = BigInt(blockHex).toString();
            const entry = chainHeaders[blockNum];
            if (entry == null) return Promise.resolve(null);
            return Promise.resolve({
              number: blockHex,
              hash: entry.hash,
              timestamp: `0x${entry.timestamp.toString(16)}`,
            });
          },
        },
        chainCfg: { chainId },
      };
    },
  } as never;
}

describeIf('aave multi-chain stitch (Y2 — §3.5 acceptance gate)', () => {
  const expected = loadExpected();
  const blockHeaders = loadBlockHeaders();
  const govLogs = loadFixtureLogs('mainnet-governance.json');
  const vmLogs = loadFixtureLogs('polygon-voting-machine.json');
  const ethPcLogs = loadFixtureLogs('mainnet-payloads-controller.json');
  const opPcLogs = loadFixtureLogs('optimism-payloads-controller.json');

  // Seeded IDs (set once in beforeAll, stable across all tests)
  let daoId = '';

  // Repositories shared across tests
  let actorResolution: ArchiveActorResolutionRepository;
  let voteRead: VoteEventsProjectionReadRepository;

  // Ingestion listeners
  let govListener: EventsListener;
  let vmListener: EventsListener;
  let ethPcListener: EventsListener;
  let opPcListener: EventsListener;

  // Derivation appliers
  let govApplier: AaveGovernanceProjectionApplier;
  let vmApplier: AaveVoteProjectionApplier;
  let ethPcApplier: AavePayloadStitchApplier;
  let opPcApplier: AavePayloadStitchApplier;

  beforeAll(async () => {
    actorResolution = new ArchiveActorResolutionRepository(pgDb);
    voteRead = new VoteEventsProjectionReadRepository(chDb);

    const archiveEventRepo = new ArchiveEventRepository(pgDb);
    const dlqRepo = new DlqRepository(pgDb);
    const archiveDerivation = new ArchiveDerivationRepository(pgDb);
    const proposalRepo = new ProposalRepository(pgDb);
    const aaveProposalRepo = new AaveProposalRepository(pgDb);

    // ── Seed source_type rows ────────────────────────────────────────────────
    await pgDb
      .insertInto('source_type')
      .values([
        { value: 'aave_governance_v3' },
        { value: 'aave_voting_machine' },
        { value: 'aave_payloads_controller' },
      ])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    // ── Seed DAO ─────────────────────────────────────────────────────────────
    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `aave-stitch-y2-${Date.now()}`,
        name: 'Aave Y2 Stitch Test',
        primary_token_address: `0x${'00'.repeat(20)}`,
        primary_chain_id: '1',
        description: 'Y2 multi-chain stitch acceptance gate',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        created_at: SEED_DATE,
        updated_at: SEED_DATE,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoId = dao.id;

    // ── Seed dao_source rows ─────────────────────────────────────────────────
    const insertSource = async (
      sourceType: string,
      chainId: string,
      config: Record<string, string>,
    ) => {
      const row = await pgDb
        .insertInto('dao_source')
        .values({
          dao_id: daoId,
          source_type: sourceType,
          chain_id: chainId,
          source_config: config,
          active_from_block: null,
          active_to_block: null,
          backfill_started_at_block: null,
          backfill_head_block: null,
          created_at: SEED_DATE,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    };

    const govDaoSourceId = await insertSource('aave_governance_v3', CHAIN_ETH, {
      governance_address: GOV_ADDR,
    });
    const vmDaoSourceId = await insertSource('aave_voting_machine', CHAIN_POL, {
      voting_machine_address: VM_ADDR,
    });
    const ethPcDaoSourceId = await insertSource('aave_payloads_controller', CHAIN_ETH, {
      payloads_controller_address: PC_ETH_ADDR,
    });
    const opPcDaoSourceId = await insertSource('aave_payloads_controller', CHAIN_OP, {
      payloads_controller_address: PC_OP_ADDR,
    });

    // ── Build ingestion listeners ─────────────────────────────────────────────
    const makeCtx = (
      daoSourceId: string,
      sourceType: string,
      chainId: string,
    ): ArchiveWriteContext => ({
      daoSourceId,
      sourceType,
      chainId,
      sourceLabel: sourceType,
    });

    govListener = makeAaveGovernanceIngesterListener({
      archiveWriter: new AaveGovernanceArchiveWriter({
        eventRepo: new AaveGovernanceEventRepository({ chDb }),
        archiveEventRepo,
        dlqRepo,
        logger: silentLogger,
      }),
      context: makeCtx(govDaoSourceId, 'aave_governance_v3', CHAIN_ETH),
      logger: silentLogger,
      dlqRepo,
    });

    vmListener = makeAaveVotingMachineIngesterListener({
      archiveWriter: new AaveVotingMachineArchiveWriter({
        eventRepo: new AaveVotingMachineEventRepository({ chDb }),
        archiveEventRepo,
        dlqRepo,
        logger: silentLogger,
      }),
      context: makeCtx(vmDaoSourceId, 'aave_voting_machine', CHAIN_POL),
      logger: silentLogger,
      dlqRepo,
    });

    ethPcListener = makeAavePayloadsControllerIngesterListener({
      archiveWriter: new AavePayloadsControllerArchiveWriter({
        eventRepo: new AavePayloadsControllerEventRepository({ chDb }),
        archiveEventRepo,
        dlqRepo,
        logger: silentLogger,
      }),
      context: makeCtx(ethPcDaoSourceId, 'aave_payloads_controller', CHAIN_ETH),
      logger: silentLogger,
      dlqRepo,
    });

    opPcListener = makeAavePayloadsControllerIngesterListener({
      archiveWriter: new AavePayloadsControllerArchiveWriter({
        eventRepo: new AavePayloadsControllerEventRepository({ chDb }),
        archiveEventRepo,
        dlqRepo,
        logger: silentLogger,
      }),
      context: makeCtx(opPcDaoSourceId, 'aave_payloads_controller', CHAIN_OP),
      logger: silentLogger,
      dlqRepo,
    });

    // ── Build derivation appliers ─────────────────────────────────────────────
    const fakeRegistry = makeFakeRegistry(blockHeaders);

    govApplier = new AaveGovernanceProjectionApplier({
      pgDb,
      archive: archiveDerivation,
      dlq: dlqRepo,
      payloads: new AaveGovernanceArchivePayloadRepository(chDb),
      ipfsFetcher: new AaveIpfsTitleFetcher(),
      metrics: { batchLookupSeconds: () => {}, processed: () => {} },
      logger: silentLogger,
    });

    vmApplier = new AaveVoteProjectionApplier({
      archive: archiveDerivation,
      dlq: dlqRepo,
      payloads: new AaveVotingMachineArchivePayloadRepository(chDb),
      proposals: proposalRepo,
      aaveProposals: aaveProposalRepo,
      voteRead,
      voteWrite: new VoteEventsProjectionWriter(chDb),
      metrics: { batchLookupSeconds: () => {}, chWriteSeconds: () => {}, processed: () => {} },
      registry: fakeRegistry,
      logger: silentLogger,
    });

    const makeStitchApplier = () =>
      new AavePayloadStitchApplier({
        pgDb,
        archive: archiveDerivation,
        dlq: dlqRepo,
        payloads: new AavePayloadsControllerArchivePayloadRepository(chDb),
        proposals: proposalRepo,
        aaveProposals: aaveProposalRepo,
        metrics: { batchLookupSeconds: () => {}, processed: () => {} },
        registry: fakeRegistry,
        logger: silentLogger,
      });

    ethPcApplier = makeStitchApplier();
    opPcApplier = makeStitchApplier();

    void ethPcDaoSourceId;
    void opPcDaoSourceId;
  }, 60_000);

  afterAll(async () => {
    if (!daoId) return;
    // Cascade deletes dao_source, then archive_event rows for this DAO's sources, etc.
    await pgDb.deleteFrom('dao').where('id', '=', daoId).execute();
  });

  beforeEach(async () => {
    // Reset derived PG state between scenarios. ClickHouse archive events are idempotent
    // (ReplacingMergeTree); vote_events_projection rows are isolated by the new proposal UUID
    // each test derives, so no CH cleanup is needed.
    await sql`DELETE FROM archive_event WHERE 1=1`.execute(pgDb);
    await sql`DELETE FROM proposal WHERE 1=1`.execute(pgDb);
    await sql`DELETE FROM actor_address WHERE 1=1`.execute(pgDb);
    await sql`DELETE FROM actor WHERE 1=1`.execute(pgDb);
    await sql`DELETE FROM ingestion_dlq WHERE 1=1`.execute(pgDb);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  async function ingest(listener: EventsListener, logs: FixtureLog[]): Promise<void> {
    for (const log of logs) {
      await listener([toLogEvent(log)]);
    }
  }

  async function resolveActors(): Promise<void> {
    await pgDb
      .updateTable('archive_event')
      .set({ derivation_actor_resolved_at: sql`now()` })
      .where('derivation_actor_resolved_at', 'is', null)
      .execute();
  }

  async function derive(applier: {
    eventTypes: readonly ArchiveEventType[];
    applyBatch(rows: Parameters<AaveGovernanceProjectionApplier['applyBatch']>[0]): Promise<void>;
  }): Promise<void> {
    const rows = await actorResolution.findDerivableBy(applier.eventTypes, 500);
    if (rows.length > 0) {
      await applier.applyBatch(
        rows as Parameters<AaveGovernanceProjectionApplier['applyBatch']>[0],
      );
    }
  }

  async function deriveAll(): Promise<void> {
    // Phase 1: governance creates proposals + declares payloads
    await derive(govApplier);
    // Phase 2: votes require proposal to exist
    await derive(vmApplier as unknown as typeof govApplier);
    // Phase 3: payload stitch requires declared payload rows from Phase 1
    await derive(ethPcApplier as unknown as typeof govApplier);
    await derive(opPcApplier as unknown as typeof govApplier);
    // Second pass — held rows can now resolve after dependencies are present
    await derive(vmApplier as unknown as typeof govApplier);
    await derive(ethPcApplier as unknown as typeof govApplier);
    await derive(opPcApplier as unknown as typeof govApplier);
  }

  // ── Test 1: in-order full stitch ─────────────────────────────────────────────

  it('in-order stitch — proposal ↔ votes ↔ payloads match expected.json', async () => {
    await ingest(govListener, govLogs);
    await ingest(vmListener, vmLogs);
    await ingest(ethPcListener, ethPcLogs);
    await ingest(opPcListener, opPcLogs);
    await resolveActors();
    await deriveAll();

    // ── Proposal state ────────────────────────────────────────────────────────
    const proposal = await pgDb
      .selectFrom('proposal')
      .select(['id', 'source_id', 'state'])
      .where('source_id', '=', expected.proposal.source_id)
      .where('source_type', '=', 'aave_governance_v3')
      .where('dao_id', '=', daoId)
      .executeTakeFirst();
    expect(proposal, 'proposal should be derived').toBeDefined();
    expect(proposal!.state).toBe(expected.proposal.state);

    // ── Voting chain binding (AC #2) ──────────────────────────────────────────
    const meta = await pgDb
      .selectFrom('aave_proposal_metadata')
      .select('voting_chain_id')
      .where('proposal_id', '=', proposal!.id)
      .executeTakeFirst();
    expect(meta?.voting_chain_id).toBe(expected.proposal.voting_chain_id);

    // ── Payloads ──────────────────────────────────────────────────────────────
    for (const expPayload of expected.payloads) {
      const payload = await pgDb
        .selectFrom('aave_proposal_payload')
        .select(['status', 'executed_at_destination'])
        .where('proposal_id', '=', proposal!.id)
        .where('target_chain_id', '=', expPayload.target_chain_id)
        .executeTakeFirst();
      expect(payload, `payload for chain ${expPayload.target_chain_id}`).toBeDefined();
      expect(payload!.status).toBe(expPayload.status);
      if (expPayload.status === 'executed') {
        expect(payload!.executed_at_destination).toBeInstanceOf(Date);
      } else {
        expect(payload!.executed_at_destination).toBeNull();
      }
    }

    // ── Votes from ClickHouse (AC #2: votes tied to proposal) ─────────────────
    const voters = await voteRead.listVotersForProposal({
      daoId,
      proposalId: proposal!.id,
    });
    expect(voters).toHaveLength(expected.votes.length);
    const sortedExpVotes = [...expected.votes].sort((a, b) => a.voter.localeCompare(b.voter));
    const sortedVoters = [...voters].sort((a, b) => a.voter_address.localeCompare(b.voter_address));
    for (const [i, v] of sortedVoters.entries()) {
      expect(v.voter_address.toLowerCase()).toBe(sortedExpVotes[i]!.voter.toLowerCase());
    }
  }, 60_000);

  // ── Test 2: out-of-order / held path ─────────────────────────────────────────

  it('out-of-order — payload events held until governance derives, then resolve', async () => {
    // Payload events arrive before ProposalCreated
    await ingest(ethPcListener, ethPcLogs);
    await ingest(opPcListener, opPcLogs);
    await resolveActors();

    await derive(ethPcApplier as unknown as typeof govApplier);
    await derive(opPcApplier as unknown as typeof govApplier);

    // All payload archive_events should remain underived (held)
    const heldCount = await pgDb
      .selectFrom('archive_event')
      .select(pgDb.fn.countAll<string>().as('n'))
      .where('source_type', '=', 'aave_payloads_controller')
      .where('derived_at', 'is', null)
      .executeTakeFirstOrThrow();
    expect(Number(heldCount.n)).toBeGreaterThan(0);

    // Now ingest governance + voting and re-derive
    await ingest(govListener, govLogs);
    await ingest(vmListener, vmLogs);
    await resolveActors();
    await deriveAll();

    const proposal = await pgDb
      .selectFrom('proposal')
      .select(['id', 'state'])
      .where('source_id', '=', expected.proposal.source_id)
      .where('source_type', '=', 'aave_governance_v3')
      .where('dao_id', '=', daoId)
      .executeTakeFirstOrThrow();
    expect(proposal.state).toBe('executed');

    // Ethereum payload must be stitched after the held events resolve
    const ethPayload = await pgDb
      .selectFrom('aave_proposal_payload')
      .select(['status', 'executed_at_destination'])
      .where('proposal_id', '=', proposal.id)
      .where('target_chain_id', '=', CHAIN_ETH)
      .executeTakeFirst();
    expect(ethPayload?.status).toBe('executed');
    expect(ethPayload?.executed_at_destination).toBeInstanceOf(Date);
  }, 60_000);

  // ── Test 3: lossy-execution (AC #6 authoritative gate) ────────────────────────

  it('lossy-execution (AC #6) — omitted PayloadExecuted leaves Optimism payload queued', async () => {
    // opPcLogs contains only PayloadCreated + PayloadQueued (no PayloadExecuted) by fixture
    // construction — this IS the lossy case. No filtering needed.
    await ingest(govListener, govLogs);
    await ingest(vmListener, vmLogs);
    await ingest(ethPcListener, ethPcLogs);
    await ingest(opPcListener, opPcLogs);
    await resolveActors();
    await deriveAll();

    const proposal = await pgDb
      .selectFrom('proposal')
      .select(['id', 'state'])
      .where('source_id', '=', expected.proposal.source_id)
      .where('source_type', '=', 'aave_governance_v3')
      .where('dao_id', '=', daoId)
      .executeTakeFirstOrThrow();

    // Governance-level proposal is executed (not degraded by a missing payload event)
    expect(proposal.state).toBe('executed');

    // Ethereum payload: fully executed
    const ethPayload = await pgDb
      .selectFrom('aave_proposal_payload')
      .select(['status', 'executed_at_destination'])
      .where('proposal_id', '=', proposal.id)
      .where('target_chain_id', '=', CHAIN_ETH)
      .executeTakeFirst();
    expect(ethPayload?.status).toBe('executed');
    expect(ethPayload?.executed_at_destination).toBeInstanceOf(Date);

    // Optimism payload: queued — PayloadExecuted never arrived
    const opPayload = await pgDb
      .selectFrom('aave_proposal_payload')
      .select(['status', 'executed_at_destination'])
      .where('proposal_id', '=', proposal.id)
      .where('target_chain_id', '=', CHAIN_OP)
      .executeTakeFirst();
    expect(opPayload, 'Optimism payload should exist (declared via PayloadSent)').toBeDefined();
    expect(opPayload!.status).toBe('queued');
    expect(opPayload!.executed_at_destination).toBeNull();
  }, 60_000);
});
