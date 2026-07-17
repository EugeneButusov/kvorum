import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMetrics } from '@libs/observability';
import { EventPoller } from './event-poller.js';
import type { EventPollerOptions, LogEvent } from './types.js';
import { FailoverRpcClient } from '../client/failover-rpc-client.js';
import { FakeProvider } from '../test-utils/fake-provider.js';

async function readCounter(name: string, labels: Record<string, string>): Promise<number> {
  const text = await renderMetrics();
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue;
    if (Object.entries(labels).every(([k, v]) => line.includes(`${k}="${v}"`))) {
      const m = line.match(/\}\s+([\d.]+)\s*$/);
      if (m) return parseFloat(m[1]!);
    }
  }
  return 0;
}

const CHAIN_ID = '0x7a69';
const TX_HASH = '0x' + 'ab'.repeat(32);
const BLOCK_HASH = '0x' + 'cd'.repeat(32);
const ADDRESS = '0x' + 'aa'.repeat(20);

function makeLog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    blockNumber: '0x1',
    blockHash: BLOCK_HASH,
    transactionHash: TX_HASH,
    transactionIndex: '0x0',
    logIndex: '0x0',
    address: ADDRESS,
    topics: [],
    data: '0x',
    ...overrides,
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
  overrides: Partial<EventPollerOptions> = {},
): EventPollerOptions {
  return {
    rpcClient: client,
    chainId: CHAIN_ID,
    chainName: 'test',
    headLag: 12,
    filter: { address: ADDRESS },
    sourceType: 'compound_governor',
    daoSourceLabel: 'dao-1',
    pollIntervalMs: 50,
    stopTimeoutMs: 500,
    ...overrides,
  };
}

describe('EventPoller', () => {
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

  describe('start() guard', () => {
    it('throws when no listener registered', async () => {
      const poller = new EventPoller(baseOpts(client));
      await expect(poller.start()).rejects.toThrow(
        'EventPoller.start() requires at least one listener registered via onEvents()',
      );
    });

    it('throws if restarted after stop', async () => {
      fake.enqueueSuccess('0x10').enqueueSuccess([]);
      const poller = new EventPoller(baseOpts(client));
      poller.onEvents(() => {});
      await poller.start();
      await poller.stop();
      await expect(poller.start()).rejects.toThrow('terminal-after-stop');
    });

    it('stop() before start() resolves immediately and marks poller terminal', async () => {
      const poller = new EventPoller(baseOpts(client));
      await poller.stop();
      poller.onEvents(() => {});
      await expect(poller.start()).rejects.toThrow('terminal-after-stop');
    });
  });

  describe('event normalization', () => {
    it('delivers normalized LogEvent to listener', async () => {
      fake
        .enqueueSuccess('0x10')
        .enqueueSuccess([makeLog({ address: ADDRESS.toUpperCase(), topics: ['0xABCD'] })]);
      fake.returnSuccess([]);

      const received: LogEvent[] = [];
      const poller = new EventPoller(baseOpts(client, { pollIntervalMs: 200 }));
      poller.onEvents((evs) => {
        received.push(...evs);
      });
      await poller.start();
      await poller.stop();

      expect(received).toHaveLength(1);
      expect(received[0]!.address).toBe(ADDRESS.toLowerCase());
      expect(received[0]!.topics[0]).toBe('0xabcd');
      expect(received[0]!.sourceType).toBe('compound_governor');
      expect(received[0]!.chainId).toBe(CHAIN_ID);
    });

    it('drops logs missing required fields', async () => {
      const malformed = { ...makeLog(), blockHash: null };
      fake.enqueueSuccess('0x10').enqueueSuccess([malformed]);
      fake.returnSuccess([]);

      const received: LogEvent[] = [];
      const poller = new EventPoller(baseOpts(client));
      poller.onEvents((evs) => {
        received.push(...evs);
      });
      await poller.start();
      await poller.stop();

      expect(received).toHaveLength(0);
    });

    it('drops logs with unparseable blockNumber instead of crashing the tick', async () => {
      // blockNumber=null would crash BigInt() in the old code path; ensure we drop + keep going.
      const malformed = { ...makeLog(), blockNumber: null };
      const goodLog = makeLog({ logIndex: '0x1' });
      fake.enqueueSuccess('0x10').enqueueSuccess([malformed, goodLog]);
      fake.returnSuccess([]);

      const received: LogEvent[] = [];
      const poller = new EventPoller(baseOpts(client));
      poller.onEvents((evs) => {
        received.push(...evs);
      });
      await expect(poller.start()).resolves.toBeUndefined();
      await poller.stop();

      expect(received).toHaveLength(1);
      expect(received[0]!.logIndex).toBe(1);
    });

    it('drops logs with non-array topics instead of crashing the tick', async () => {
      const malformed = { ...makeLog(), topics: 'not-an-array' };
      fake.enqueueSuccess('0x10').enqueueSuccess([malformed]);
      fake.returnSuccess([]);

      const received: LogEvent[] = [];
      const poller = new EventPoller(baseOpts(client));
      poller.onEvents((evs) => {
        received.push(...evs);
      });
      await expect(poller.start()).resolves.toBeUndefined();
      await poller.stop();

      expect(received).toHaveLength(0);
    });

    it('counts removed:true logs via metric and still delivers to listener', async () => {
      const before = await readCounter('test_ingestion_logs_with_removed_flag_total', {
        dao_source: 'dao-1',
      });
      const removedLog = makeLog({ removed: true });
      fake.enqueueSuccess('0x10').enqueueSuccess([removedLog]);
      fake.returnSuccess([]);

      const received: LogEvent[] = [];
      const poller = new EventPoller(baseOpts(client));
      poller.onEvents((evs) => {
        received.push(...evs);
      });
      await poller.start();
      await poller.stop();

      expect(received).toHaveLength(1);
      const after = await readCounter('test_ingestion_logs_with_removed_flag_total', {
        dao_source: 'dao-1',
      });
      expect(after - before).toBe(1);
    });
  });

  describe('filter immutability', () => {
    it('does not reflect post-construction mutations to caller filter', async () => {
      const filter = { address: ADDRESS };
      fake.enqueueSuccess('0x10').enqueueSuccess([makeLog()]);
      fake.returnSuccess([]);

      const received: LogEvent[] = [];
      const poller = new EventPoller(baseOpts(client, { filter }));
      poller.onEvents((evs) => {
        received.push(...evs);
      });
      filter.address = '0x' + 'ff'.repeat(20);
      await poller.start();
      await poller.stop();

      expect(received[0]!.address).toBe(ADDRESS.toLowerCase());
    });
  });

  describe('listener fan-out + isolation', () => {
    it('delivers to multiple listeners in parallel; a throwing listener does not break others', async () => {
      fake.enqueueSuccess('0x10').enqueueSuccess([makeLog()]);
      fake.returnSuccess([]);

      const goodReceived: LogEvent[] = [];
      const poller = new EventPoller(baseOpts(client));
      poller.onEvents(() => {
        throw new Error('intentional listener error');
      });
      poller.onEvents((evs) => {
        goodReceived.push(...evs);
      });
      await poller.start();
      await poller.stop();

      expect(goodReceived).toHaveLength(1);
    });

    it('unsubscribe removes listener', async () => {
      fake.enqueueSuccess('0x10').enqueueSuccess([makeLog()]);
      fake.returnSuccess([]);

      const received: LogEvent[] = [];
      const poller = new EventPoller(baseOpts(client));
      const unsub = poller.onEvents((evs) => {
        received.push(...evs);
      });
      unsub();
      await expect(poller.start()).rejects.toThrow('requires at least one listener');
    });
  });

  describe('onFirstHeadComplete', () => {
    it('fires once after first successful tick', async () => {
      fake.enqueueSuccess('0x10').enqueueSuccess([makeLog()]);
      fake.returnSuccess([]);
      fake.returnSuccess('0x11').returnSuccess([]);

      const onFirstHeadComplete = vi.fn();
      const poller = new EventPoller(baseOpts(client, { onFirstHeadComplete }));
      poller.onEvents(() => {});
      await poller.start();
      await new Promise<void>((r) => setTimeout(r, 80));
      await poller.stop();

      expect(onFirstHeadComplete).toHaveBeenCalledTimes(1);
      expect(onFirstHeadComplete).toHaveBeenCalledWith(4n);
    });

    it('does not fire when any listener rejects', async () => {
      fake.enqueueSuccess('0x10').enqueueSuccess([makeLog()]);
      fake.returnSuccess([]);

      const onFirstHeadComplete = vi.fn();
      const poller = new EventPoller(baseOpts(client, { onFirstHeadComplete }));
      poller.onEvents(async () => {
        throw new Error('listener failed');
      });
      poller.onEvents(() => {});
      await poller.start();
      await poller.stop();

      expect(onFirstHeadComplete).not.toHaveBeenCalled();
    });

    it('fires when no events are returned', async () => {
      fake.enqueueSuccess('0x10').enqueueSuccess([]);
      fake.returnSuccess([]);

      const onFirstHeadComplete = vi.fn();
      const poller = new EventPoller(baseOpts(client, { onFirstHeadComplete }));
      poller.onEvents(() => {});
      await poller.start();
      await poller.stop();

      expect(onFirstHeadComplete).toHaveBeenCalledWith(4n);
    });
  });

  describe('re-entry guard', () => {
    it('skips overlapping ticks when previous is still in flight', async () => {
      let resolveFirst!: () => void;
      let tickCount = 0;

      // Use a custom rpcClient mock
      let callCount = 0;
      const mockRpc = {
        send: vi.fn(async (_method: string) => {
          callCount++;
          if (callCount === 1) {
            // first eth_blockNumber — stall
            await new Promise<void>((r) => {
              resolveFirst = r;
            });
            return '0x10';
          }
          if (callCount === 2) return []; // eth_getLogs for first tick
          if (callCount === 3) return '0x10'; // second eth_blockNumber (if it fires)
          return [];
        }),
        getHealth: () => ({ chainId: CHAIN_ID, providers: [] }),
        start: async () => {},
        stop: async () => {},
      };

      const poller = new EventPoller({
        ...baseOpts(client),
        rpcClient: mockRpc,
        pollIntervalMs: 10,
      });
      poller.onEvents(() => {
        tickCount++;
      });

      const startPromise = poller.start();
      // First tick is stalled — let the interval fire once to confirm it's guarded
      await new Promise<void>((r) => setTimeout(r, 40));
      resolveFirst(); // unblock first tick
      await startPromise;
      await poller.stop();

      // Only one set of events should have been delivered
      expect(tickCount).toBeLessThanOrEqual(1);
    });
  });

  describe('stop() deadline', () => {
    it('resolves within stopTimeoutMs even if listener never settles', async () => {
      fake.enqueueSuccess('0x10').enqueueSuccess([makeLog()]);
      fake.returnSuccess([]);

      const poller = new EventPoller(baseOpts(client, { stopTimeoutMs: 100, pollIntervalMs: 30 }));
      poller.onEvents(() => new Promise(() => {})); // never resolves

      // Fire start() without awaiting — the first tick will block on the hanging listener
      void poller.start();
      // Give the tick a chance to start
      await new Promise<void>((r) => setTimeout(r, 30));

      const startedAt = Date.now();
      await poller.stop(); // must resolve within stopTimeoutMs (100ms)
      expect(Date.now() - startedAt).toBeLessThan(400);
    });
  });
  describe('poll cursor (catch-up)', () => {
    /** An RpcClient recording every eth_getLogs range, so tests assert what was actually fetched. */
    function stubClient(tipBlock: bigint, logs: Record<string, unknown>[] = []) {
      const ranges: Array<{ from: bigint; to: bigint }> = [];
      const rpcClient = {
        send: async (method: string, params: unknown[]) => {
          if (method === 'eth_blockNumber') return '0x' + tipBlock.toString(16);
          if (method === 'eth_getLogs') {
            const f = (params as [{ fromBlock: string; toBlock: string }])[0];
            ranges.push({ from: BigInt(f.fromBlock), to: BigInt(f.toBlock) });
            return logs;
          }
          return null;
        },
        getHealth: () => ({ chainId: CHAIN_ID, providers: [] }),
      } as unknown as FailoverRpcClient;
      return { rpcClient, ranges };
    }

    function memoryCursor(initial: bigint | null) {
      let value = initial;
      return {
        store: {
          read: async () => value,
          write: async (b: bigint) => {
            value = b;
          },
        },
        get value() {
          return value;
        },
      };
    }

    /** headLag 12 → confirmed head = tip - 12. */
    async function runOneTick(opts: Partial<EventPollerOptions>, client: FailoverRpcClient) {
      const poller = new EventPoller(baseOpts(client, { ...opts, pollIntervalMs: 10_000 }));
      poller.onEvents(() => {});
      await poller.start();
      await poller.stop();
    }

    it('resumes from the cursor rather than the confirmed-head window', async () => {
      const { rpcClient, ranges } = stubClient(1_000n);
      const cursor = memoryCursor(400n);

      await runOneTick({ cursor: cursor.store, maxBlocksPerTick: 1_000 }, rpcClient);

      // Confirmed head = 1000 - 12 = 988. Without a cursor this would start at 988 - 24 = 964 and
      // blocks 401..963 would never be read.
      expect(ranges).toEqual([{ from: 401n, to: 988n }]);
      expect(cursor.value).toBe(988n);
    });

    it('caps a large backlog at maxBlocksPerTick', async () => {
      const { rpcClient, ranges } = stubClient(10_000n);
      const cursor = memoryCursor(0n);

      await runOneTick({ cursor: cursor.store, maxBlocksPerTick: 500 }, rpcClient);

      // One provider-sized chunk, not a 9,988-block demand that eth_getLogs would reject.
      expect(ranges).toEqual([{ from: 1n, to: 500n }]);
      expect(cursor.value).toBe(500n);
    });

    it('walks a backlog across ticks until it reaches confirmed head', async () => {
      const { rpcClient, ranges } = stubClient(1_100n);
      const cursor = memoryCursor(1_000n);

      const poller = new EventPoller(
        baseOpts(rpcClient, { cursor: cursor.store, maxBlocksPerTick: 40, pollIntervalMs: 10 }),
      );
      poller.onEvents(() => {});
      await poller.start();
      await new Promise<void>((r) => setTimeout(r, 120));
      await poller.stop();

      // Confirmed head = 1088. Chunks of 40 from 1001: 1001-1040, 1041-1080, 1081-1088, then idle.
      expect(ranges.slice(0, 3)).toEqual([
        { from: 1001n, to: 1040n },
        { from: 1041n, to: 1080n },
        { from: 1081n, to: 1088n },
      ]);
      expect(cursor.value).toBe(1088n);
      // Caught up: no range is re-fetched once the cursor sits at confirmed head.
      expect(ranges.length).toBe(3);
    });

    it('does not advance the cursor when a listener rejects', async () => {
      const { rpcClient, ranges } = stubClient(1_000n, [makeLog({ blockNumber: '0x385' })]);
      const cursor = memoryCursor(900n);

      const poller = new EventPoller(
        baseOpts(rpcClient, { cursor: cursor.store, pollIntervalMs: 10_000 }),
      );
      poller.onEvents(() => {
        throw new Error('listener down');
      });
      await poller.start();
      await poller.stop();

      // Range was fetched but not accepted — the watermark must not move past it, so the next tick
      // re-reads it rather than skipping the batch.
      expect(ranges).toEqual([{ from: 901n, to: 988n }]);
      expect(cursor.value).toBe(900n);
    });

    it('falls back to the confirmed-head window for a source never polled before', async () => {
      const { rpcClient, ranges } = stubClient(1_000n);
      const cursor = memoryCursor(null);

      await runOneTick({ cursor: cursor.store }, rpcClient);

      // null cursor = never seen. Scanning from genesis is a backfill's job, so bound the first
      // fetch to the confirmed-head window: 988 - 24 = 964.
      expect(ranges).toEqual([{ from: 964n, to: 988n }]);
    });

    it('skips the tick when the cursor is already at confirmed head', async () => {
      const { rpcClient, ranges } = stubClient(1_000n);
      const cursor = memoryCursor(988n);

      await runOneTick({ cursor: cursor.store }, rpcClient);

      expect(ranges).toEqual([]);
      expect(cursor.value).toBe(988n);
    });

    it('skips the tick when the cursor cannot be read', async () => {
      const { rpcClient, ranges } = stubClient(1_000n);

      await runOneTick(
        {
          cursor: {
            read: async () => {
              throw new Error('db down');
            },
            write: async () => {},
          },
        },
        rpcClient,
      );

      // Better to poll nothing than to guess a range and punch a hole.
      expect(ranges).toEqual([]);
    });
  });
});
