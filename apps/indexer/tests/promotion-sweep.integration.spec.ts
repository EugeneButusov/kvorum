import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChainConfig } from '@libs/chain';
import { ConfirmationRepository, pgDb } from '@libs/db';
import { metricPrefix } from '@libs/observability';
import { createAnvilTestContext } from './_harness/anvil-test-context';
import type { AnvilTestContext } from './_harness/anvil-test-context';
import { captureMetrics, getHistogramSampleCount } from './_harness/metrics-helpers';
import {
  insertTestDao,
  insertTestDaoSource,
  insertPendingConfirmation,
  pollUntil,
  truncateAllIngestionTables,
} from './_harness/pg-test-fixtures';
import { PromotionSweepService } from '../src/orchestrator/promotion-sweep.service';

const ANVIL_URL = process.env['ANVIL_RPC_URL'];
const DB_URL = process.env['DATABASE_URL'];

const describeIf = ANVIL_URL && DB_URL ? describe : describe.skip;

const CHAIN_CFG: ChainConfig = {
  chainId: '0x7a69',
  name: 'anvil',
  reorgHorizon: 2,
  headPollIntervalMs: 200,
  sweepIntervalMs: 500,
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

describeIf('F2-anvil-2 promotion sweep healthy chain', () => {
  let anvilCtx: AnvilTestContext;
  let sweepService: PromotionSweepService;
  let daoId: string;
  let daoSourceId: string;

  beforeAll(async () => {
    anvilCtx = await createAnvilTestContext(CHAIN_CFG);
    const confirmationRepo = new ConfirmationRepository(pgDb);
    sweepService = new PromotionSweepService(anvilCtx.registry, confirmationRepo);
  }, 30_000);

  afterAll(async () => {
    await sweepService.onApplicationShutdown();
    await anvilCtx.cleanup();
  });

  beforeEach(async () => {
    await truncateAllIngestionTables(pgDb);
    daoId = await insertTestDao(pgDb, { slug: 'sweep-dao', name: 'Sweep DAO' });
    daoSourceId = await insertTestDaoSource(pgDb, {
      daoId,
      sourceType: 'compound_governor',
      chainId: '0x7a69',
      contractAddress: '0x' + '00'.repeat(20),
    });
  });

  it('promotes pending rows once head advances past block_number + reorgHorizon', async () => {
    const client = anvilCtx.client;

    const baseHex = await client.send<string>('eth_blockNumber', []);
    const base = BigInt(baseHex);

    const block1 = await client.send<{ hash: string; number: string }>('eth_getBlockByNumber', [
      '0x' + (base + 1n).toString(16),
      false,
    ]);
    const block2 = await client.send<{ hash: string; number: string }>('eth_getBlockByNumber', [
      '0x' + (base + 2n).toString(16),
      false,
    ]);

    await insertPendingConfirmation(pgDb, {
      daoSourceId,
      chainId: '0x7a69',
      blockHash: (block1?.hash ?? '0x' + 'aa'.repeat(32)).toLowerCase(),
      blockNumber: base + 1n,
      txHash: '0x' + 'ff'.repeat(32),
      logIndex: 0,
      sourceType: 'compound_governor',
    });
    await insertPendingConfirmation(pgDb, {
      daoSourceId,
      chainId: '0x7a69',
      blockHash: (block2?.hash ?? '0x' + 'bb'.repeat(32)).toLowerCase(),
      blockNumber: base + 2n,
      txHash: '0x' + 'fe'.repeat(32),
      logIndex: 0,
      sourceType: 'compound_governor',
    });

    await client.send('anvil_mine', ['0x4']);

    await anvilCtx.headTracker.awaitFirstHead();

    const metricsSnapshot = await captureMetrics();

    await sweepService.onApplicationBootstrap();

    await pollUntil(async () => {
      const rows = await pgDb
        .selectFrom('archive_confirmation')
        .select('confirmation_status')
        .where('chain_id', '=', '0x7a69')
        .execute();
      return rows.length === 2 && rows.every((r) => r.confirmation_status === 'confirmed');
    }, 5_000);

    const confirmations = await pgDb
      .selectFrom('archive_confirmation')
      .selectAll()
      .where('chain_id', '=', '0x7a69')
      .execute();

    expect(confirmations).toHaveLength(2);
    for (const row of confirmations) {
      expect(row.confirmation_status).toBe('confirmed');
      expect(row.confirmed_at).not.toBeNull();
    }

    const sweepSamples = await getHistogramSampleCount(
      `${metricPrefix}_ingestion_promotion_sweep_duration_seconds`,
      { chain_id: '0x7a69' },
      metricsSnapshot,
    );
    expect(sweepSamples).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
