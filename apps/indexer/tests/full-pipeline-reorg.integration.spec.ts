import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chDb, pgDb } from '@libs/db';
import {
  COMPOUND_EMITTER_DEPLOY_BYTECODE,
  EMIT_VALID_SELECTOR,
} from './_fixtures/compound-emitter.bytecode';
import { awaitHead } from './helpers/anvil-test-context';
import { captureMetrics, getCounterDelta } from './helpers/metrics-helpers';
import {
  insertTestDao,
  insertTestDaoSource,
  pollUntil,
  truncateAllIngestionTables,
  truncateAllTestTables,
} from './helpers/pg-test-fixtures';
import { DerivationWorkerService } from '../src/derivation/derivation-worker.service';
import { IndexerModule } from '../src/indexer/indexer.module';
import { ChainContextRegistry } from '../src/orchestrator/chain-context-registry';

const ANVIL_URL = process.env['ANVIL_RPC_URL'];
const DB_URL = process.env['DATABASE_URL'];

const describeIf = ANVIL_URL && DB_URL ? describe : describe.skip;

/** Sends a transaction and polls until the receipt is available. */
async function sendAndWait(
  client: { send: <T>(method: string, params: unknown[]) => Promise<T> },
  tx: { from: string; to?: string; data: string },
): Promise<{ transactionHash: string; blockNumber: string; contractAddress: string | null }> {
  const txHash = await client.send<string>('eth_sendTransaction', [tx]);
  let receipt: {
    transactionHash: string;
    blockNumber: string;
    contractAddress: string | null;
  } | null = null;
  const deadline = Date.now() + 10_000;
  while (!receipt && Date.now() < deadline) {
    receipt = await client.send<typeof receipt>('eth_getTransactionReceipt', [txHash]);
    if (!receipt) await new Promise<void>((r) => setTimeout(r, 100));
  }
  if (!receipt) throw new Error(`Receipt not found for tx ${txHash}`);
  return receipt;
}

describeIf('F3 full-pipeline reorg', () => {
  let app: INestApplicationContext;
  let client: { send: <T>(method: string, params: unknown[]) => Promise<T> };
  let contractAddress: string;
  let accounts: string[];
  let daoSourceId: string;

  beforeAll(async () => {
    await truncateAllTestTables(pgDb);
    process.env['CHAIN_CONFIG'] = JSON.stringify({
      chains: [
        {
          chainId: '0x7a69',
          name: 'anvil',
          reorgHorizon: 12,
          headPollIntervalMs: 200,
          sweepIntervalMs: 500,
          eventPollIntervalMs: 200,
          providers: [
            { name: 'anvil', url: ANVIL_URL, kind: 'http', priority: 1, timeoutMs: 4_000 },
          ],
        },
      ],
    });

    // 1. Deploy the CompoundEmitter contract BEFORE booting Nest so the orchestrator
    //    reads the seeded dao_source on onApplicationBootstrap.
    const deployClient = (await import('@libs/chain').then(
      ({ FailoverRpcClient }) =>
        new FailoverRpcClient({
          chainId: '0x7a69',
          name: 'anvil',
          reorgHorizon: 12,
          providers: [
            { name: 'anvil', url: ANVIL_URL!, kind: 'http', priority: 1, timeoutMs: 4_000 },
          ],
        }),
    )) as {
      send: <T>(method: string, params: unknown[]) => Promise<T>;
      start: () => Promise<void>;
      stop: () => Promise<void>;
    };
    await deployClient.start();

    accounts = await deployClient.send<string[]>('eth_accounts', []);
    const receipt = await sendAndWait(deployClient, {
      from: accounts[0]!,
      data: COMPOUND_EMITTER_DEPLOY_BYTECODE,
    });
    contractAddress = receipt.contractAddress!.toLowerCase();
    await deployClient.stop();

    // 2. Seed dao + dao_source ONCE before app.init() — truncateAllIngestionTables
    //    preserves them across beforeEach calls (F3-prep change).
    const daoId = await insertTestDao(pgDb, {
      slug: 'compound-f3-reorg',
      name: 'Compound F3 Reorg Test',
    });
    daoSourceId = await insertTestDaoSource(pgDb, {
      daoId,
      sourceType: 'compound_governor_bravo',
      chainId: '0x7a69',
      contractAddress,
    });

    // 3. Boot the full IndexerModule — orchestrator reads the seeded dao_source.
    app = await NestFactory.createApplicationContext(IndexerModule, { abortOnError: false });
    await app.init();
    client = app.get(ChainContextRegistry).peek('0x7a69')!.client as typeof client;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await truncateAllTestTables(pgDb);
  });

  beforeEach(async () => {
    await truncateAllIngestionTables(pgDb);
    await truncateDerivedTables();
    await sql`
      ALTER TABLE event_archive_compound_governor_bravo
      DELETE WHERE chain_id = '0x7a69'
    `.execute(chDb);
  });

  it('orphans live-poller events, writes reorg_event, re-emits canonical events', async () => {
    const emitValidData = '0x' + EMIT_VALID_SELECTOR;

    // 1. Emit ProposalCreated on the current branch
    const preEmitReceipt = await sendAndWait(client, {
      from: accounts[0]!,
      to: contractAddress,
      data: emitValidData,
    });
    const preReorgTxHash = preEmitReceipt.transactionHash.toLowerCase();
    const eventBlockNumber = parseInt(preEmitReceipt.blockNumber, 16);

    // 2. Mine 2 more blocks so the event sits at head-2
    await client.send('anvil_mine', ['0x2']);

    // 3. Wait for HeadTracker to observe head = eventBlockNumber + 2.
    //    Required so the ReorgDetector's sliding-window buffer contains the event's
    //    block_hash before anvil_reorg fires.
    const chainCtx = app.get(ChainContextRegistry).peek('0x7a69')!;
    await awaitHead(chainCtx, eventBlockNumber + 2);

    // 4. Wait for EventPoller to write the pending archive row
    await pollUntil(async () => {
      const rows = await pgDb
        .selectFrom('archive_confirmation')
        .selectAll()
        .where('chain_id', '=', '0x7a69')
        .execute();
      return rows.length === 1 && rows[0]!.confirmation_status === 'pending';
    }, 20_000);

    const preReorg = await pgDb
      .selectFrom('archive_confirmation')
      .selectAll()
      .where('chain_id', '=', '0x7a69')
      .execute();
    expect(preReorg).toHaveLength(1);
    const orphanedBlockHash = preReorg[0]!.block_hash;
    expect(preReorg[0]!.tx_hash).toBe(preReorgTxHash);

    const metricsBefore = await captureMetrics();

    // 5. Reorg: drop 3 blocks (event-block + 2 padding), re-emit on canonical branch.
    //
    // Anvil puts reverted transactions back into the mempool after a reorg. Without
    // intervention, `anvil_mine ['0x1']` would re-mine the original event tx → same
    // block hash → ReorgDetector Case 3a (hashes match) → only orphans blocks N+1, N+2
    // and misses the event at N.
    //
    // Fix:
    //  1. Drop all mempool txs so the spacer block is genuinely empty.
    //  2. Mine the empty spacer at eventBlockNumber (different tx_root → different hash).
    //  3. Poll for the reorg_event to confirm Case 3b fired and orphaning is complete.
    //  4. Re-emit — event lands at eventBlockNumber+1 (different parent → different hash).
    await client.send('anvil_reorg', [3, []]);
    await client.send('anvil_dropAllTransactions', []); // clear reverted txs from mempool
    await client.send('anvil_mine', ['0x1']); // spacer at eventBlockNumber — truly empty

    await pollUntil(async () => {
      const rows = await pgDb
        .selectFrom('reorg_event')
        .selectAll()
        .where('chain_id', '=', '0x7a69')
        .execute();
      return rows.length >= 1;
    }, 10_000);

    // Re-emit on canonical branch — event lands at eventBlockNumber + 1.
    const postEmitReceipt = await sendAndWait(client, {
      from: accounts[0]!,
      to: contractAddress,
      data: emitValidData,
    });
    const postReorgTxHash = postEmitReceipt.transactionHash.toLowerCase();

    // 6. Wait for ReorgWatcher to orphan the old row AND EventPoller to insert the new pending row
    await pollUntil(async () => {
      const rows = await pgDb
        .selectFrom('archive_confirmation')
        .selectAll()
        .where('chain_id', '=', '0x7a69')
        .execute();
      return (
        rows.length === 2 &&
        rows.some((r) => r.confirmation_status === 'orphaned') &&
        rows.some((r) => r.confirmation_status === 'pending')
      );
    }, 20_000);

    const postReorg = await pgDb
      .selectFrom('archive_confirmation')
      .selectAll()
      .where('chain_id', '=', '0x7a69')
      .execute();

    // SPEC §3.4 #1 — orphaned row
    const orphaned = postReorg.find((r) => r.confirmation_status === 'orphaned')!;
    expect(orphaned.block_hash).toBe(orphanedBlockHash);
    expect(orphaned.tx_hash).toBe(preReorgTxHash);
    expect(orphaned.orphaned_at).not.toBeNull();
    expect(orphaned.orphaned_by_reorg_event_id).not.toBeNull();

    // SPEC §3.4 #2 — reorg_event row linking to the orphaned row (F2b atomic write)
    const reorgEvents = await pgDb.selectFrom('reorg_event').selectAll().execute();
    expect(reorgEvents).toHaveLength(1);
    expect(reorgEvents[0]!.orphaned_block_hashes).toContain(orphanedBlockHash);
    expect(orphaned.orphaned_by_reorg_event_id).toBe(reorgEvents[0]!.id);

    // SPEC §3.4 #3 — canonical post-reorg event arrives as a NEW row with different block_hash.
    // Regression check for the 23505 partial-unique race-window rider (ADR-041 2026-05-12).
    const canonical = postReorg.find((r) => r.confirmation_status === 'pending')!;
    expect(canonical.tx_hash).toBe(postReorgTxHash);
    expect(canonical.block_hash).not.toBe(orphanedBlockHash);
    expect(canonical.id).not.toBe(orphaned.id);

    // SPEC §3.4 #4 — no derived state for orphaned events (vacuously true until G1 ships)
    const proposals = await pgDb.selectFrom('proposal').selectAll().execute();
    expect(proposals).toHaveLength(0);

    // Metric deltas — deterministic single-reorg shape
    const reorgEventDelta = await getCounterDelta(
      `indexer_ingestion_reorg_event_total`,
      { chain_id: '0x7a69' },
      metricsBefore,
    );
    const orphanedDelta = await getCounterDelta(
      `indexer_ingestion_orphaned_events_total`,
      { chain_id: '0x7a69' },
      metricsBefore,
    );
    expect(reorgEventDelta).toBe(1);
    expect(orphanedDelta).toBe(1);
  }, 60_000);

  it('SPEC §3.4 #5 — re-running G1 derivation produces same final state (G1 acceptance)', async () => {
    const derivationWorker = app.get(DerivationWorkerService);

    const createdReceipt = await sendAndWait(client, {
      from: accounts[0]!,
      to: contractAddress,
      data: '0x' + EMIT_VALID_SELECTOR,
    });

    await pollUntil(async () => {
      const row = await pgDb
        .selectFrom('archive_confirmation')
        .select(['id'])
        .where('chain_id', '=', '0x7a69')
        .where('tx_hash', '=', createdReceipt.transactionHash.toLowerCase())
        .executeTakeFirst();
      return row !== undefined;
    }, 20_000);

    await pgDb
      .updateTable('archive_confirmation')
      .set({
        confirmation_status: 'confirmed',
        confirmed_at: new Date(),
      })
      .where('chain_id', '=', '0x7a69')
      .where('tx_hash', '=', createdReceipt.transactionHash.toLowerCase())
      .execute();

    await pollUntil(async () => {
      await derivationWorker.tick();
      const snapshot = await readProposalSnapshot();
      return (
        snapshot.proposals.length === 1 &&
        snapshot.actions.length === 1 &&
        snapshot.choices.length === 3
      );
    }, 20_000);

    const createdSnapshot = await readProposalSnapshot();
    const proposal = createdSnapshot.proposals[0]!;
    expect(proposal.source_type).toBe('compound_governor_bravo');
    expect(proposal.source_id).toBe('1');
    expect(proposal.voting_power_block).toBe('100');
    expect(proposal.voting_starts_block).toBe('100');
    expect(proposal.voting_ends_block).toBe('200');
    expect(proposal.state).toBe('pending');
    expect(createdSnapshot.actions).toEqual([
      expect.objectContaining({
        action_index: 0,
        target_address: '0x0000000000000000000000000000000000000002',
        target_chain_id: '0x7a69',
        value_wei: '0',
        function_signature: '',
        calldata: '0x',
      }),
    ]);
    expect(createdSnapshot.choices).toEqual([
      expect.objectContaining({ choice_index: 0, value: 'Against' }),
      expect.objectContaining({ choice_index: 1, value: 'For' }),
      expect.objectContaining({ choice_index: 2, value: 'Abstain' }),
    ]);

    await pgDb
      .updateTable('archive_confirmation')
      .set({ derived_at: null })
      .where('tx_hash', '=', createdReceipt.transactionHash.toLowerCase())
      .execute();
    await derivationWorker.tick();

    const replaySnapshot = await readProposalSnapshot();
    expect(replaySnapshot.proposals).toHaveLength(1);
    expect(replaySnapshot.proposals[0]!.id).toBe(proposal.id);
    expect(replaySnapshot.actions).toHaveLength(1);
    expect(replaySnapshot.choices).toHaveLength(3);

    await insertConfirmedCompoundArchiveEvent({
      eventType: 'ProposalExecuted',
      blockNumber: 9_000_001n,
      txHash: numberedHash(1),
      blockHash: numberedHash(101),
      payload: { proposalId: '1' },
    });
    await derivationWorker.tick();

    const executed = await readOnlyProposal();
    expect(executed.state).toBe('executed');

    await insertConfirmedCompoundArchiveEvent({
      eventType: 'ProposalQueued',
      blockNumber: 9_000_002n,
      txHash: numberedHash(2),
      blockHash: numberedHash(102),
      payload: { proposalId: '1', eta: '123' },
    });
    await derivationWorker.tick();

    const afterLateQueued = await readProposalSnapshot();
    expect(afterLateQueued.proposals).toHaveLength(1);
    expect(afterLateQueued.proposals[0]!.id).toBe(proposal.id);
    expect(afterLateQueued.proposals[0]!.state).toBe('executed');
    expect(afterLateQueued.actions).toHaveLength(1);
    expect(afterLateQueued.choices).toHaveLength(3);
  }, 60_000);

  async function insertConfirmedCompoundArchiveEvent(opts: {
    eventType: 'ProposalQueued' | 'ProposalExecuted' | 'ProposalCanceled';
    blockNumber: bigint;
    txHash: string;
    blockHash: string;
    payload: Record<string, string>;
  }): Promise<void> {
    await chDb
      .insertInto('event_archive_compound_governor_bravo')
      .values({
        dao_source_id: daoSourceId,
        chain_id: '0x7a69',
        block_number: opts.blockNumber.toString(),
        block_hash: opts.blockHash,
        tx_hash: opts.txHash,
        log_index: 0,
        event_type: opts.eventType,
        payload: JSON.stringify(opts.payload),
      })
      .execute();

    await pgDb
      .insertInto('archive_confirmation')
      .values({
        source_type: 'compound_governor_bravo',
        dao_source_id: daoSourceId,
        chain_id: '0x7a69',
        block_number: opts.blockNumber.toString(),
        block_hash: opts.blockHash,
        tx_hash: opts.txHash,
        log_index: 0,
        event_type: opts.eventType,
        received_at: new Date(),
        confirmation_status: 'confirmed',
        confirmed_at: new Date(),
        orphaned_at: null,
        orphaned_by_reorg_event_id: null,
        derived_at: null,
      })
      .execute();
  }
});

async function truncateDerivedTables(): Promise<void> {
  await sql`TRUNCATE proposal, actor RESTART IDENTITY CASCADE`.execute(pgDb);
}

async function readOnlyProposal() {
  const proposal = await pgDb.selectFrom('proposal').selectAll().executeTakeFirst();
  expect(proposal).toBeDefined();
  return proposal!;
}

async function readProposalSnapshot() {
  const proposals = await pgDb.selectFrom('proposal').selectAll().orderBy('id', 'asc').execute();
  const actions = await pgDb
    .selectFrom('proposal_action')
    .selectAll()
    .orderBy('action_index', 'asc')
    .execute();
  const choices = await pgDb
    .selectFrom('proposal_choice')
    .selectAll()
    .orderBy('choice_index', 'asc')
    .execute();

  return { proposals, actions, choices };
}

function numberedHash(value: number): string {
  return '0x' + value.toString(16).padStart(64, '0');
}
