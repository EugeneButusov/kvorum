import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeadTracker } from './head-tracker.js';
import type { HeadTrackerOptions } from './types.js';
import { FailoverRpcClient } from '../client/failover-rpc-client.js';
import { FakeProvider } from '../test-utils/fake-provider.js';

const CHAIN_ID = '0x7a69';

function makeBlock(number = 16, hash = '0x' + 'cd'.repeat(32)): Record<string, unknown> {
  return {
    number: '0x' + number.toString(16),
    hash,
    parentHash: '0x' + 'aa'.repeat(32),
    timestamp: '0x' + Math.floor(Date.now() / 1000 - 2).toString(16),
  };
}

async function makeClient(fake: FakeProvider): Promise<FailoverRpcClient> {
  fake.enqueueChainId('0x7a69'); // 31337 — satisfies eth_chainId probe during start()
  const client = new FailoverRpcClient({
    chainId: CHAIN_ID,
    name: 'test',
    headLag: 12,
    providers: [{ name: 'fake', url: fake.url, kind: 'http', priority: 1, timeoutMs: 4_000 }],
  });
  await client.start();
  return client;
}

function baseOpts(
  client: FailoverRpcClient,
  overrides: Partial<HeadTrackerOptions> = {},
): HeadTrackerOptions {
  return {
    rpcClient: client,
    chainCfg: { chainId: CHAIN_ID, name: 'test', headLag: 12, providers: [] },
    pollIntervalMs: 50,
    stopTimeoutMs: 500,
    ...overrides,
  };
}

describe('HeadTracker', () => {
  let fake: FakeProvider;
  let client: FailoverRpcClient;

  beforeEach(async () => {
    fake = await FakeProvider.create();
    client = await makeClient(fake);
  });

  afterEach(async () => {
    await client?.stop();
    await fake.close();
  });

  describe('start / stop lifecycle', () => {
    it('throws if restarted after stop', async () => {
      fake.returnSuccess(makeBlock());
      const tracker = new HeadTracker(baseOpts(client));
      await tracker.start();
      await tracker.stop();
      await expect(tracker.start()).rejects.toThrow('terminal-after-stop');
    });

    it('stop() before start() resolves and marks tracker terminal', async () => {
      const tracker = new HeadTracker(baseOpts(client));
      await tracker.stop();
      await expect(tracker.start()).rejects.toThrow('terminal-after-stop');
    });
  });

  describe('getLastHead()', () => {
    it('returns null before first tick', async () => {
      const tracker = new HeadTracker(baseOpts(client));
      expect(tracker.getLastHead()).toBeNull();
    });

    it('returns non-null after first tick', async () => {
      fake.returnSuccess(makeBlock(10));
      const tracker = new HeadTracker(baseOpts(client));
      await tracker.start();
      await tracker.stop();
      const head = tracker.getLastHead();
      expect(head).not.toBeNull();
      expect(head!.blockNumber).toBe(10n);
      expect(head!.chainId).toBe(CHAIN_ID);
    });
  });

  describe('awaitFirstHead()', () => {
    it('resolves with the first observed head', async () => {
      fake.returnSuccess(makeBlock(42));
      const tracker = new HeadTracker(baseOpts(client));
      const headPromise = tracker.awaitFirstHead();
      await tracker.start();
      const head = await headPromise;
      await tracker.stop();
      expect(head.blockNumber).toBe(42n);
    });

    it('returns immediately if head already known', async () => {
      fake.returnSuccess(makeBlock(5));
      const tracker = new HeadTracker(baseOpts(client));
      await tracker.start();
      const head = await tracker.awaitFirstHead();
      await tracker.stop();
      expect(head.blockNumber).toBe(5n);
    });

    it('rejects synchronously when called after stop() (no cached head)', async () => {
      const tracker = new HeadTracker(baseOpts(client));
      await tracker.stop();
      await expect(tracker.awaitFirstHead()).rejects.toThrow(
        'HeadTracker stopped before first head',
      );
    });

    it('rejects if stop() called before first head arrives', async () => {
      // Use a directly controlled mock RPC so we can unblock the call after stop()
      let unblockRpc!: () => void;
      const mockRpc = {
        send: vi.fn(
          () =>
            new Promise<never>((_resolve, _reject) => {
              unblockRpc = () => _reject(new Error('rpc cancelled'));
            }),
        ),
        getHealth: () => ({ chainId: CHAIN_ID, providers: [] as [] }),
        start: async () => {},
        stop: async () => {},
      };

      const tracker = new HeadTracker({
        rpcClient: mockRpc,
        chainCfg: { chainId: CHAIN_ID, name: 'test', headLag: 12, providers: [] },
        pollIntervalMs: 50,
        stopTimeoutMs: 200,
      });

      // Attach rejection handler immediately to avoid unhandled rejection
      const headCaught = tracker.awaitFirstHead().catch((e: unknown) => e as Error);
      const startPromise = tracker.start();
      await tracker.stop();
      unblockRpc(); // let the stalled RPC call reject so tick() + start() can complete

      const err = await headCaught;
      expect(err.message).toBe('HeadTracker stopped before first head');
      await expect(startPromise).resolves.toBeUndefined();
    });
  });

  describe('listener fan-out', () => {
    it('delivers to onHead listener on each tick', async () => {
      fake.returnSuccess(makeBlock(7));
      const blockNumbers: bigint[] = [];
      const tracker = new HeadTracker(baseOpts(client, { pollIntervalMs: 30 }));
      tracker.onHead(({ headBlock }) => {
        blockNumbers.push(headBlock);
      });
      await tracker.start();
      await new Promise<void>((r) => setTimeout(r, 80));
      await tracker.stop();
      expect(blockNumbers.length).toBeGreaterThanOrEqual(1);
      expect(blockNumbers[0]).toBe(7n);
    });

    it('unsubscribe stops listener from receiving heads', async () => {
      fake.returnSuccess(makeBlock());
      const received: bigint[] = [];
      const tracker = new HeadTracker(baseOpts(client, { pollIntervalMs: 30 }));
      const unsub = tracker.onHead(({ headBlock }) => {
        received.push(headBlock);
      });
      unsub();
      await tracker.start();
      await new Promise<void>((r) => setTimeout(r, 60));
      await tracker.stop();
      expect(received).toHaveLength(0);
    });

    it('a throwing listener does not break other listeners', async () => {
      fake.returnSuccess(makeBlock(99));
      const goodHeads: bigint[] = [];
      const tracker = new HeadTracker(baseOpts(client));
      tracker.onHead(() => {
        throw new Error('bad listener');
      });
      tracker.onHead(({ headBlock }) => {
        goodHeads.push(headBlock);
      });
      await tracker.start();
      await tracker.stop();
      expect(goodHeads).toHaveLength(1);
    });
  });

  describe('head normalization', () => {
    it('lowercases blockHash and parentHash', async () => {
      fake.returnSuccess(makeBlock(1, '0x' + 'CD'.repeat(32)));
      const tracker = new HeadTracker(baseOpts(client));
      await tracker.start();
      await tracker.stop();
      expect(tracker.getLastHead()!.blockHash).toBe('0x' + 'cd'.repeat(32));
    });

    it('drops malformed block (missing timestamp) instead of crashing the tick', async () => {
      const malformed = { ...makeBlock(1), timestamp: null };
      fake.returnSuccess(malformed);
      const tracker = new HeadTracker(baseOpts(client));
      await expect(tracker.start()).resolves.toBeUndefined();
      await tracker.stop();
      expect(tracker.getLastHead()).toBeNull();
    });

    it('drops malformed block (missing parentHash) instead of crashing the tick', async () => {
      const malformed = { ...makeBlock(1), parentHash: null };
      fake.returnSuccess(malformed);
      const tracker = new HeadTracker(baseOpts(client));
      await expect(tracker.start()).resolves.toBeUndefined();
      await tracker.stop();
      expect(tracker.getLastHead()).toBeNull();
    });
  });
});
