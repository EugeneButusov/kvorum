import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChainContextRegistry } from '@libs/chain';
import { pgDb } from '@libs/db';
import {
  EVM_TEST_EMITTER_DEPLOY_BYTECODE,
  EMIT_MALFORMED_SELECTOR,
} from './_fixtures/evm-test-emitter.bytecode';
import { TestIndexerModule } from './_fixtures/test-indexer.module';
import { captureMetrics, findMetricValue, getCounterDelta } from './helpers/metrics-helpers';
import {
  insertTestDao,
  insertTestDaoSource,
  pollUntil,
  truncateAllIngestionTables,
  truncateAllTestTables,
} from './helpers/pg-test-fixtures';

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

describeIf('DLQ fault injection', () => {
  let app: INestApplicationContext;
  let client: { send: <T>(method: string, params: unknown[]) => Promise<T> };
  let contractAddress: string;
  let accounts: string[];

  beforeAll(async () => {
    await truncateAllTestTables(pgDb);
    // DlqDepthService ticks at 500ms in tests — keeps gauge assertion window tight.
    process.env['DLQ_DEPTH_INTERVAL_MS'] = '500';
    process.env['CHAIN_CONFIG'] = JSON.stringify({
      chains: [
        {
          chainId: '0x7a69',
          name: 'anvil',
          headLag: 12,
          headPollIntervalMs: 200,
          eventPollIntervalMs: 200,
          providers: [
            { name: 'anvil', url: ANVIL_URL, kind: 'http', priority: 1, timeoutMs: 4_000 },
          ],
        },
      ],
    });

    // Deploy the EVM test emitter BEFORE booting Nest.
    const deployClient = (await import('@libs/chain').then(
      ({ FailoverRpcClient }) =>
        new FailoverRpcClient({
          chainId: '0x7a69',
          name: 'anvil',
          headLag: 12,
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

    const daoId = await insertTestDao(pgDb, { slug: 'dlq-fault-test', name: 'DLQ Fault Test' });
    await insertTestDaoSource(pgDb, {
      daoId,
      sourceType: 'evm_test_emitter',
      chainId: '0x7a69',
      contractAddress,
    });

    app = await NestFactory.createApplicationContext(TestIndexerModule, { abortOnError: false });
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

  it('routes malformed payloads to DLQ with stage=archive_decode', async () => {
    const metricsBefore = await captureMetrics();

    // Emit the malformed event — truncated 8-byte data, correct topic0
    await sendAndWait(client, {
      from: accounts[0]!,
      to: contractAddress,
      data: '0x' + EMIT_MALFORMED_SELECTOR,
    });
    await client.send('anvil_mine', ['0x2']);

    // Wait for at least one DLQ row to appear. EventPoller's sliding window re-fetches
    // the same malformed log every eventPollIntervalMs, so each re-fetch inserts a new
    // DLQ row (no idempotency on the archive tuple — deferred to I2's retry/accept work).
    // We assert "≥ 1" rather than "exactly 1" to tolerate that race.
    await pollUntil(async () => {
      const rows = await pgDb.selectFrom('ingestion_dlq').selectAll().execute();
      return rows.length >= 1;
    }, 20_000);

    const dlqRows = await pgDb.selectFrom('ingestion_dlq').selectAll().execute();
    expect(dlqRows.length).toBeGreaterThanOrEqual(1);
    // All DLQ rows for this fault share the same shape — verify on the first one.
    expect(dlqRows[0]!.stage).toBe('archive_decode');
    expect(dlqRows[0]!.source).toBe('evm_test_emitter');
    expect(dlqRows[0]!.archive_source_type).toBe('evm_test_emitter');
    expect(dlqRows[0]!.archive_chain_id).toBe('0x7a69');
    // archive_tx_hash is populated from the raw log envelope before decoding — regression
    // guard that the DLQ row captures the envelope for the retry path.
    expect(dlqRows[0]!.archive_tx_hash).not.toBeNull();

    // No archive_event row: decode check failed, never reached the archive writer
    const archiveRows = await pgDb.selectFrom('archive_event').selectAll().execute();
    expect(archiveRows).toHaveLength(0);

    // archive_writes{result=inserted} must NOT increment for this malformed event
    const insertedDelta = await getCounterDelta(
      `indexer_ingestion_archive_writes_total`,
      { result: 'inserted', source: 'evm_test_emitter', chain_id: '0x7a69' },
      metricsBefore,
    );
    expect(insertedDelta).toBe(0);

    // Gauge reflects at least one DLQ entry (delta-based: robust against residual values
    // from earlier test runs). 20s window covers ≥2 DlqDepthService ticks at 500ms.
    await pollUntil(async () => {
      const after = await captureMetrics();
      const before =
        findMetricValue(metricsBefore, `indexer_ingestion_dlq_size`, {
          stage: 'archive_decode',
          source: 'evm_test_emitter',
        }) ?? 0;
      const now =
        findMetricValue(after, `indexer_ingestion_dlq_size`, {
          stage: 'archive_decode',
          source: 'evm_test_emitter',
        }) ?? 0;
      return now - before >= 1;
    }, 20_000);
  }, 60_000);
});
