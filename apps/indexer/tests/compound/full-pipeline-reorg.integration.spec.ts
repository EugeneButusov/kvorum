import type { INestApplicationContext } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChainContextRegistry } from '@libs/chain';
import { pgDb } from '@libs/db';
import {
  EVM_TEST_EMITTER_DEPLOY_BYTECODE,
  EMIT_VALID_SELECTOR,
} from '../_fixtures/evm-test-emitter.bytecode';
import { TestEvmIndexerModule } from '../_fixtures/test-evm-indexer.module';
import { TestEvmSourceModule } from '../_fixtures/test-source.module';
import { awaitHead } from '../helpers/anvil-test-context';
import { captureMetrics, getCounterDelta } from '../helpers/metrics-helpers';
import {
  insertTestDao,
  insertTestDaoSource,
  pollUntil,
  truncateAllIngestionTables,
  truncateAllTestTables,
} from '../helpers/pg-test-fixtures';

const ANVIL_URL = process.env['ANVIL_RPC_URL'];
const DB_URL = process.env['DATABASE_URL'];

const describeIf = ANVIL_URL && DB_URL ? describe : describe.skip;

@Module({ imports: [TestEvmIndexerModule, TestEvmSourceModule] })
class FullPipelineReorgTestModule {}

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

describeIf('full-pipeline reorg', () => {
  let app: INestApplicationContext;
  let client: { send: <T>(method: string, params: unknown[]) => Promise<T> };
  let contractAddress: string;
  let accounts: string[];

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
      data: EVM_TEST_EMITTER_DEPLOY_BYTECODE,
    });
    contractAddress = receipt.contractAddress!.toLowerCase();
    await deployClient.stop();

    const daoId = await insertTestDao(pgDb, { slug: 'reorg-test', name: 'Reorg Test' });
    await insertTestDaoSource(pgDb, {
      daoId,
      sourceType: 'evm_test_emitter',
      chainId: '0x7a69',
      contractAddress,
    });

    app = await NestFactory.createApplicationContext(FullPipelineReorgTestModule, {
      abortOnError: false,
    });
    await app.init();
    client = app.get(ChainContextRegistry).peek('0x7a69')!.client as typeof client;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await truncateAllTestTables(pgDb);
  });

  beforeEach(async () => {
    await truncateAllIngestionTables(pgDb);
  });

  it('orphans live-poller events, writes reorg_event, re-emits canonical events', async () => {
    const emitValidData = '0x' + EMIT_VALID_SELECTOR;

    // 1. Emit event on the current branch
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

    // SPEC §3.4 #4 — no derived state for orphaned events
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
});
