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

// NOTE: The DLQ decode-fault test (stage='archive_decode') moved to PR-D: the consumer
// is the decode layer; in producer-only mode (PR-C) the generic producer enqueues all
// confirmed logs as archive_ch jobs without decoding — no DLQ entries are created.
// This test verifies producer-only behavior: seen_log populated, archive_event empty.
describeIf('Producer fault injection (PR-C producer-only)', () => {
  let app: INestApplicationContext;
  let client: { send: <T>(method: string, params: unknown[]) => Promise<T> };
  let contractAddress: string;
  let accounts: string[];

  beforeAll(async () => {
    await truncateAllTestTables(pgDb);
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

    const daoId = await insertTestDao(pgDb, { slug: 'producer-test', name: 'Producer Test' });
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

  it('producer records confirmed logs in seen_log without writing archive_event or DLQ', async () => {
    // The generic archive producer is domain-blind: it records the chain coordinate in
    // seen_log and enqueues an archive_ch job — no decoding, no archive_event write, no DLQ.
    // Mine extra blocks so confirmedHead reaches the event block (headLag=12 → need 13+ blocks).
    await client.send('anvil_mine', ['0xd']); // 13 blocks
    await sendAndWait(client, {
      from: accounts[0]!,
      to: contractAddress,
      data: '0x' + EMIT_MALFORMED_SELECTOR, // content irrelevant — producer is domain-blind
    });
    await client.send('anvil_mine', ['0xd']); // 13 more → confirmedHead includes event block

    // Wait for seen_log to record the coordinate (proves the producer processed the event)
    await pollUntil(async () => {
      const rows = await pgDb.selectFrom('seen_log').selectAll().execute();
      return rows.length >= 1;
    }, 30_000);

    const seenRows = await pgDb.selectFrom('seen_log').selectAll().execute();
    expect(seenRows.length).toBeGreaterThanOrEqual(1);
    expect(seenRows[0]!.chain_id).toBe('0x7a69');
    expect(seenRows[0]!.tx_hash).not.toBeNull();

    // Producer does not write archive_event — that is the consumer's responsibility (PR-D)
    const archiveRows = await pgDb.selectFrom('archive_event').selectAll().execute();
    expect(archiveRows).toHaveLength(0);

    // Producer does not route to DLQ — decode failures are a consumer concern (PR-D)
    const dlqRows = await pgDb.selectFrom('ingestion_dlq').selectAll().execute();
    expect(dlqRows).toHaveLength(0);
  }, 60_000);
});
