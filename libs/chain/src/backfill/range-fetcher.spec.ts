import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackfillChunkTooSmallError } from './errors/backfill-chunk-too-small.error.js';
import { BackfillRangeFetcher } from './range-fetcher.js';
import { FailoverRpcClient } from '../client/failover-rpc-client.js';
import { silentLogger } from '../logger.js';
import { chainMetrics } from '../metrics/metrics.js';
import { FakeProvider } from '../test-utils/fake-provider.js';

const CHAIN_ID = '0x1';
const ADDRESS = '0x' + 'aa'.repeat(20);

function makeRawLog(blockNumber: bigint, logIndex = 0): Record<string, unknown> {
  return {
    blockNumber: '0x' + blockNumber.toString(16),
    blockHash: '0x' + 'cd'.repeat(32),
    transactionHash: '0x' + 'bb'.repeat(32),
    transactionIndex: '0x0',
    logIndex: '0x' + logIndex.toString(16),
    address: ADDRESS,
    topics: [],
    data: '0x',
    removed: false,
  };
}

const BASE_OPTS = {
  filter: { address: ADDRESS },
  sourceType: 'compound_governor' as const,
  chainId: CHAIN_ID,
  sourceLabel: 'compound_governor',
};

async function makeClient(fake: FakeProvider): Promise<FailoverRpcClient> {
  const client = new FailoverRpcClient(
    {
      chainId: CHAIN_ID,
      name: 'test',
      headLag: 12,
      providers: [{ name: 'fake', url: fake.url, kind: 'http', priority: 1, timeoutMs: 4_000 }],
    },
    { logger: silentLogger },
  );
  await client.start();
  return client;
}

describe('BackfillRangeFetcher', () => {
  let fake: FakeProvider;
  let client: FailoverRpcClient;

  beforeEach(async () => {
    fake = await FakeProvider.create();
    fake.enqueueChainId(CHAIN_ID); // consumed by client.start() chain verification
    client = await makeClient(fake);
  });

  afterEach(async () => {
    await client.stop();
    await fake.close();
  });

  it('#1 — happy path: range [0..2] with chunkSize=10_000 fits in one chunk', async () => {
    fake.enqueueSuccess([makeRawLog(0n, 0), makeRawLog(1n, 1), makeRawLog(2n, 2)]);

    const received: number[] = [];
    const fetcher = new BackfillRangeFetcher({
      ...BASE_OPTS,
      rpcClient: client,
      fromBlock: 0n,
      toBlock: 2n,
      listener: async (events) => {
        events.forEach((e) => received.push(Number(e.blockNumber)));
      },
    });

    const result = await fetcher.run();
    expect(result).toEqual({ completed: true });
    expect(received).toEqual([0, 1, 2]);
  });

  it('#2 — empty range: chunk returns no logs, listener not called', async () => {
    fake.enqueueSuccess([]);

    const listener = vi.fn();
    const fetcher = new BackfillRangeFetcher({
      ...BASE_OPTS,
      rpcClient: client,
      fromBlock: 100n,
      toBlock: 199n,
      listener,
    });

    const result = await fetcher.run();
    expect(result).toEqual({ completed: true });
    expect(listener).not.toHaveBeenCalled();
  });

  it('#3 — adaptive shrink: -32005 halves chunk size then completes', async () => {
    // fromBlock=0, toBlock=19_999, initial chunkSize=10_000
    // First request [0..9999] → -32005; shrink to 5000
    // Retry [0..4999] → success; then [5000..9999] → success; [10000..14999] → success; [15000..19999] → success
    fake
      .enqueue({ type: 'rpcError', code: -32005, message: 'too many results' })
      .enqueueSuccess([makeRawLog(4999n)])
      .enqueueSuccess([makeRawLog(9999n)])
      .enqueueSuccess([makeRawLog(14999n)])
      .enqueueSuccess([makeRawLog(19999n)]);

    const chunkEnds: bigint[] = [];
    const fetcher = new BackfillRangeFetcher({
      ...BASE_OPTS,
      rpcClient: client,
      fromBlock: 0n,
      toBlock: 19_999n,
      chunkSize: 10_000,
      listener: vi.fn().mockResolvedValue(undefined),
      onChunkComplete: async (end) => {
        chunkEnds.push(end);
      },
      logger: silentLogger,
    });

    const result = await fetcher.run();
    expect(result).toEqual({ completed: true });
    // After shrink to 5000, four 5000-block chunks cover [0..19999]
    expect(chunkEnds).toHaveLength(4);
    expect(chunkEnds[0]).toBe(4999n);
    expect(chunkEnds[3]).toBe(19_999n);
  });

  it('#4 — shrink at floor: throws BackfillChunkTooSmallError', async () => {
    // chunkSize=1000 is exactly CHUNK_FLOOR; first error throws immediately
    fake.enqueue({ type: 'rpcError', code: -32005, message: 'too many results' });

    const fetcher = new BackfillRangeFetcher({
      ...BASE_OPTS,
      rpcClient: client,
      fromBlock: 0n,
      toBlock: 999n,
      chunkSize: 1_000,
      listener: vi.fn(),
      logger: silentLogger,
    });

    await expect(fetcher.run()).rejects.toThrow(BackfillChunkTooSmallError);
  });

  it('#5 — AbortSignal: cancels before second chunk', async () => {
    fake.enqueueSuccess([makeRawLog(0n)]).enqueueSuccess([makeRawLog(10_000n)]);

    const controller = new AbortController();
    let chunkCount = 0;

    const fetcher = new BackfillRangeFetcher({
      ...BASE_OPTS,
      rpcClient: client,
      fromBlock: 0n,
      toBlock: 19_999n,
      chunkSize: 10_000,
      signal: controller.signal,
      listener: vi.fn().mockResolvedValue(undefined),
      onChunkComplete: async (end) => {
        chunkCount++;
        if (end === 9_999n) controller.abort();
      },
    });

    const result = await fetcher.run();
    expect(result).toMatchObject({ cancelled: true, lastCompletedBlock: 9_999n });
    expect(chunkCount).toBe(1);
  });

  it('#6 — progress gauge advances monotonically per chunk', async () => {
    const recordSpy = vi.spyOn(chainMetrics.backfillProgressBlock, 'record');
    fake.enqueueSuccess([makeRawLog(9_999n)]).enqueueSuccess([makeRawLog(19_999n)]);

    const fetcher = new BackfillRangeFetcher({
      ...BASE_OPTS,
      rpcClient: client,
      fromBlock: 0n,
      toBlock: 19_999n,
      chunkSize: 10_000,
      listener: vi.fn().mockResolvedValue(undefined),
    });

    await fetcher.run();
    expect(recordSpy).toHaveBeenCalledTimes(2);
    expect(recordSpy).toHaveBeenNthCalledWith(1, 9_999, { source: 'compound_governor' });
    expect(recordSpy).toHaveBeenNthCalledWith(2, 19_999, { source: 'compound_governor' });
    recordSpy.mockRestore();
  });

  it('#7 — onChunkComplete called before gauge (checkpoint ordering)', async () => {
    const callOrder: string[] = [];
    const recordSpy = vi
      .spyOn(chainMetrics.backfillProgressBlock, 'record')
      .mockImplementation(() => {
        callOrder.push('gauge');
      });
    fake.enqueueSuccess([]);

    const fetcher = new BackfillRangeFetcher({
      ...BASE_OPTS,
      rpcClient: client,
      fromBlock: 0n,
      toBlock: 9_999n,
      chunkSize: 10_000,
      listener: vi.fn().mockResolvedValue(undefined),
      onChunkComplete: async () => {
        callOrder.push('checkpoint');
      },
    });

    await fetcher.run();
    expect(callOrder).toEqual(['checkpoint', 'gauge']);
    recordSpy.mockRestore();
  });

  it('#8 — message substring "response size exceeded" triggers shrink', async () => {
    // code is -32000 (not -32005) but message matches the allowlist
    fake
      .enqueue({ type: 'rpcError', code: -32000, message: 'response size exceeded limit' })
      .enqueueSuccess([makeRawLog(4999n)])
      .enqueueSuccess([makeRawLog(9999n)]);

    const fetcher = new BackfillRangeFetcher({
      ...BASE_OPTS,
      rpcClient: client,
      fromBlock: 0n,
      toBlock: 9_999n,
      chunkSize: 10_000,
      listener: vi.fn().mockResolvedValue(undefined),
      logger: silentLogger,
    });

    const result = await fetcher.run();
    expect(result).toEqual({ completed: true });
  });

  it('#9 — non-too-many-results error propagates (no shrink attempt)', async () => {
    fake.enqueue({ type: 'httpError', status: 503 });
    // set fallback so the client can probe health but the test eth_getLogs fails fast
    fake.returnSuccess(null);

    const fetcher = new BackfillRangeFetcher({
      ...BASE_OPTS,
      rpcClient: client,
      fromBlock: 0n,
      toBlock: 9_999n,
      chunkSize: 10_000,
      listener: vi.fn(),
      logger: silentLogger,
    });

    await expect(fetcher.run()).rejects.toThrow();
  });

  it('#10 — listener throwing propagates (fail-loud backfill path)', async () => {
    fake.enqueueSuccess([makeRawLog(0n)]);

    const fetcher = new BackfillRangeFetcher({
      ...BASE_OPTS,
      rpcClient: client,
      fromBlock: 0n,
      toBlock: 9_999n,
      chunkSize: 10_000,
      listener: async () => {
        throw new Error('CH write failure');
      },
      logger: silentLogger,
    });

    await expect(fetcher.run()).rejects.toThrow('CH write failure');
  });

  it('#11 — AbortSignal already aborted before start: returns cancelled immediately', async () => {
    const controller = new AbortController();
    controller.abort();

    const listener = vi.fn();
    const fetcher = new BackfillRangeFetcher({
      ...BASE_OPTS,
      rpcClient: client,
      fromBlock: 0n,
      toBlock: 9_999n,
      chunkSize: 10_000,
      signal: controller.signal,
      listener,
    });

    const result = await fetcher.run();
    expect(result).toMatchObject({ cancelled: true, lastCompletedBlock: null });
    expect(listener).not.toHaveBeenCalled();
  });
});
