import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChainConfig } from '@libs/chain';
import { pgDb, ReorgEventRepository } from '@libs/db';
import { createAnvilTestContext } from './_harness/anvil-test-context';
import type { AnvilTestContext } from './_harness/anvil-test-context';
import { captureMetrics, getCounterDelta } from './_harness/metrics-helpers';
import {
  insertTestDao,
  insertTestDaoSource,
  insertPendingConfirmation,
  pollUntil,
  truncateAllIngestionTables,
} from './_harness/pg-test-fixtures';
import { ReorgWatcherService } from '../src/orchestrator/reorg-watcher.service';

const ANVIL_URL = process.env['ANVIL_RPC_URL'];
const DB_URL = process.env['DATABASE_URL'];

const describeIf = ANVIL_URL && DB_URL ? describe : describe.skip;

const CHAIN_CFG: ChainConfig = {
  chainId: '0x7a69',
  name: 'anvil',
  reorgHorizon: 12,
  headPollIntervalMs: 200,
  providers: [
    {
      name: 'anvil',
      url: ANVIL_URL ?? 'http://localhost:8545',
      kind: 'http',
      priority: 1,
      timeoutMs: 4_000,
    },
  ],
};

/** Wait until the head tracker has observed at least the given block number. */
async function awaitHead(ctx: AnvilTestContext, target: bigint): Promise<void> {
  await pollUntil(
    () => Promise.resolve((ctx.headTracker.getLastHead()?.blockNumber ?? -1n) >= target),
    5_000,
    50,
  );
}

describeIf('F2-anvil-1 reorg orphan flow', () => {
  let anvilCtx: AnvilTestContext;
  let reorgWatcher: ReorgWatcherService;
  let daoId: string;
  let daoSourceId: string;

  beforeAll(async () => {
    anvilCtx = await createAnvilTestContext(CHAIN_CFG);
    const reorgRepo = new ReorgEventRepository(pgDb);
    reorgWatcher = new ReorgWatcherService(reorgRepo);
    reorgWatcher.watch(anvilCtx.ctx);
  }, 30_000);

  afterAll(async () => {
    await reorgWatcher.onApplicationShutdown();
    await anvilCtx.cleanup();
  });

  beforeEach(async () => {
    await truncateAllIngestionTables(pgDb);
    daoId = await insertTestDao(pgDb, { slug: 'test-dao', name: 'Test DAO' });
    daoSourceId = await insertTestDaoSource(pgDb, {
      daoId,
      sourceType: 'compound_governor',
      chainId: '0x7a69',
      contractAddress: '0x' + '00'.repeat(20),
    });
  });

  it('orphans pending rows whose block_hash was dropped by anvil_reorg', async () => {
    const client = anvilCtx.client;

    // Sync the head tracker to the current chain tip before mining test blocks.
    // We then mine exactly 2 blocks one at a time, waiting for the tracker to observe
    // each one. This guarantees both hashes are in the reorg detector's sliding-window
    // buffer so both confirmations are included in the orphaned_block_hashes signal.
    const syncedHead = await anvilCtx.headTracker.awaitFirstHead();
    const base = syncedHead.blockNumber;

    await client.send('anvil_mine', ['0x1']);
    await awaitHead(anvilCtx, base + 1n);

    await client.send('anvil_mine', ['0x1']);
    await awaitHead(anvilCtx, base + 2n);

    const block1 = await client.send<{ hash: string; number: string }>('eth_getBlockByNumber', [
      '0x' + (base + 1n).toString(16),
      false,
    ]);
    const block2 = await client.send<{ hash: string; number: string }>('eth_getBlockByNumber', [
      '0x' + (base + 2n).toString(16),
      false,
    ]);

    const hash1 = block1.hash.toLowerCase();
    const hash2 = block2.hash.toLowerCase();
    const num1 = BigInt(block1.number);
    const num2 = BigInt(block2.number);

    const fakeTx1 = '0x' + 'ab'.repeat(32);
    const fakeTx2 = '0x' + 'cd'.repeat(32);

    await insertPendingConfirmation(pgDb, {
      daoSourceId,
      chainId: '0x7a69',
      blockHash: hash1,
      blockNumber: num1,
      txHash: fakeTx1,
      logIndex: 0,
      sourceType: 'compound_governor',
    });
    await insertPendingConfirmation(pgDb, {
      daoSourceId,
      chainId: '0x7a69',
      blockHash: hash2,
      blockNumber: num2,
      txHash: fakeTx2,
      logIndex: 0,
      sourceType: 'compound_governor',
    });

    const metricsSnapshot = await captureMetrics();

    await client.send('anvil_reorg', [2, []]);
    await client.send('anvil_mine', ['0x1']);

    await pollUntil(async () => {
      const rows = await pgDb.selectFrom('reorg_event').selectAll().execute();
      return rows.length >= 1;
    }, 5_000);

    const reorgEventDelta = await getCounterDelta(
      'kvorum_ingestion_reorg_event_total',
      { chain_id: '0x7a69' },
      metricsSnapshot,
    );
    const orphanedDelta = await getCounterDelta(
      'kvorum_ingestion_orphaned_events_total',
      { chain_id: '0x7a69' },
      metricsSnapshot,
    );

    const reorgEvents = await pgDb.selectFrom('reorg_event').selectAll().execute();
    expect(reorgEvents).toHaveLength(1);
    expect(reorgEvents[0]!.orphaned_block_hashes.length).toBeGreaterThan(0);

    const confirmations = await pgDb
      .selectFrom('archive_confirmation')
      .selectAll()
      .where('chain_id', '=', '0x7a69')
      .execute();

    const orphaned = confirmations.filter((r) => r.confirmation_status === 'orphaned');
    expect(orphaned).toHaveLength(2);
    for (const row of orphaned) {
      expect(row.orphaned_at).not.toBeNull();
      expect(row.orphaned_by_reorg_event_id).toBe(reorgEvents[0]!.id);
    }

    const byHash = new Map(confirmations.map((r) => [r.block_hash, r]));
    expect(byHash.get(hash1)!.block_hash).toBe(hash1);
    expect(byHash.get(hash2)!.block_hash).toBe(hash2);

    expect(reorgEventDelta).toBeGreaterThanOrEqual(1);
    expect(orphanedDelta).toBe(2);
  }, 30_000);

  it('skips already-confirmed siblings under the orphaned block hash (partial-orphan case)', async () => {
    const client = anvilCtx.client;

    const syncedHead = await anvilCtx.headTracker.awaitFirstHead();
    const base = syncedHead.blockNumber;

    await client.send('anvil_mine', ['0x1']);
    await awaitHead(anvilCtx, base + 1n);

    await client.send('anvil_mine', ['0x1']);
    await awaitHead(anvilCtx, base + 2n);

    const block1 = await client.send<{ hash: string; number: string }>('eth_getBlockByNumber', [
      '0x' + (base + 1n).toString(16),
      false,
    ]);
    const block2 = await client.send<{ hash: string; number: string }>('eth_getBlockByNumber', [
      '0x' + (base + 2n).toString(16),
      false,
    ]);

    const hash1 = block1.hash.toLowerCase();
    const hash2 = block2.hash.toLowerCase();
    const num1 = BigInt(block1.number);
    const num2 = BigInt(block2.number);

    const fakeTx1 = '0x' + 'ef'.repeat(32);
    const fakeTx2 = '0x' + '12'.repeat(32);

    await insertPendingConfirmation(pgDb, {
      daoSourceId,
      chainId: '0x7a69',
      blockHash: hash1,
      blockNumber: num1,
      txHash: fakeTx1,
      logIndex: 0,
      sourceType: 'compound_governor',
    });
    const pendingId = await insertPendingConfirmation(pgDb, {
      daoSourceId,
      chainId: '0x7a69',
      blockHash: hash2,
      blockNumber: num2,
      txHash: fakeTx2,
      logIndex: 0,
      sourceType: 'compound_governor',
    });

    await pgDb
      .updateTable('archive_confirmation')
      .set({ confirmation_status: 'confirmed', confirmed_at: new Date() })
      .where('id', '=', pendingId)
      .execute();

    const metricsSnapshot = await captureMetrics();

    await client.send('anvil_reorg', [2, []]);
    await client.send('anvil_mine', ['0x1']);

    await pollUntil(async () => {
      const rows = await pgDb.selectFrom('reorg_event').selectAll().execute();
      return rows.length >= 1;
    }, 5_000);

    const orphanedDelta = await getCounterDelta(
      'kvorum_ingestion_orphaned_events_total',
      { chain_id: '0x7a69' },
      metricsSnapshot,
    );

    const confirmations = await pgDb
      .selectFrom('archive_confirmation')
      .selectAll()
      .where('chain_id', '=', '0x7a69')
      .execute();

    const orphaned = confirmations.filter((r) => r.confirmation_status === 'orphaned');
    const confirmed = confirmations.filter((r) => r.confirmation_status === 'confirmed');

    expect(orphaned).toHaveLength(1);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.id).toBe(pendingId);

    expect(orphanedDelta).toBe(1);
  }, 30_000);
});
