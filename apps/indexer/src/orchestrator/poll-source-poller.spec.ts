import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { JsonValue } from '@libs/domain';
import type { PollListener, QueueProducerPort, SourceContext, PollItem } from '@sources/core';
import { PollSourcePoller } from './poll-source-poller';

vi.mock('./poll-metrics', () => ({
  pollMetrics: {
    pollTick: { add: vi.fn() },
    pollItemsEnqueued: { add: vi.fn() },
    pollLastSuccess: { record: vi.fn() },
  },
}));

const FAKE_SOURCE: SourceContext = {
  daoSourceId: 'src-poll-1',
  sourceType: 'snapshot' as never,
  chainId: 'off-chain',
  sourceLabel: 'snapshot' as never,
};

function makePollItem(id: string): PollItem {
  return {
    externalId: id,
    eventType: 'ProposalCreated',
    contentHash: `hash-${id}`,
    ordinal: null,
    payload: { id },
  };
}

function makePort(): QueueProducerPort & {
  commits: Array<{ items: readonly PollItem[]; nextCursor: unknown }>;
} {
  const commits: Array<{ items: readonly PollItem[]; nextCursor: unknown }> = [];
  return {
    commits,
    loadCursor: vi.fn().mockResolvedValue(null),
    commitTick: vi
      .fn()
      .mockImplementation(
        async (_source: SourceContext, items: readonly PollItem[], nextCursor: unknown) => {
          commits.push({ items, nextCursor });
        },
      ),
  };
}

function makePoller(
  listener: PollListener<JsonValue>,
  opts?: Partial<ConstructorParameters<typeof PollSourcePoller>[0]>,
) {
  return new PollSourcePoller({
    source: FAKE_SOURCE,
    listener,
    queuePort: makePort(),
    tickTimeoutMs: 5_000,
    stopTimeoutMs: 500,
    minIntervalMs: 0, // disable clamping so test intervalMs values work as-is
    ...opts,
  });
}

describe('PollSourcePoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs an immediate first tick, then schedules at intervalMs', async () => {
    let tickCount = 0;
    const listener: PollListener<number> = {
      intervalMs: 1_000,
      poll: vi.fn().mockImplementation(async () => ({ items: [], nextCursor: ++tickCount })),
    };
    const poller = makePoller(listener);

    const startP = poller.start();
    await vi.runAllTicks(); // flush immediate tick's microtasks
    await startP;

    expect(tickCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(tickCount).toBe(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(tickCount).toBe(3);

    await poller.stop();
  });

  it('threads cursor from tick to tick, starting from null', async () => {
    const cursors: (number | null)[] = [];
    const listener: PollListener<number> = {
      intervalMs: 500,
      poll: vi.fn().mockImplementation(async (_ctx, cursor) => {
        cursors.push(cursor);
        return { items: [], nextCursor: (cursor ?? 0) + 1 };
      }),
    };
    const poller = makePoller(listener);

    const sp = poller.start();
    await vi.runAllTicks();
    await sp; // first tick

    await vi.advanceTimersByTimeAsync(500); // second tick
    await vi.advanceTimersByTimeAsync(500); // third tick
    await poller.stop();

    expect(cursors[0]).toBeNull();
    expect(cursors[1]).toBe(1);
    expect(cursors[2]).toBe(2);
  });

  it('commits the tick (items + nextCursor) to the queue port in one call', async () => {
    const items = [makePollItem('a'), makePollItem('b')];
    const listener: PollListener<null> = {
      intervalMs: 60_000,
      poll: vi
        .fn()
        .mockResolvedValueOnce({ items, nextCursor: null })
        .mockResolvedValue({ items: [], nextCursor: null }),
    };
    const port = makePort();
    const poller = makePoller(listener, { queuePort: port });

    const sp = poller.start();
    await vi.runAllTicks();
    await sp;
    await poller.stop();

    expect(port.commits).toHaveLength(1);
    expect(port.commits[0]?.items.map((i) => i.externalId)).toEqual(['a', 'b']);
    expect(port.commits[0]?.nextCursor).toBeNull();
  });

  it('single-flight: a slow poll does not start the next tick concurrently', async () => {
    let activePollCount = 0;
    let maxConcurrent = 0;
    let resolveSlowPoll!: () => void;

    const listener: PollListener<null> = {
      intervalMs: 100,
      poll: vi.fn().mockImplementation(async () => {
        activePollCount++;
        maxConcurrent = Math.max(maxConcurrent, activePollCount);
        await new Promise<void>((r) => {
          resolveSlowPoll = r;
        });
        activePollCount--;
        return { items: [], nextCursor: null };
      }),
    };
    const poller = makePoller(listener);
    void poller.start(); // first tick blocks
    await vi.runAllTicks();

    // Advance through multiple interval ticks — all should be skipped
    await vi.advanceTimersByTimeAsync(400);
    expect(maxConcurrent).toBe(1);

    resolveSlowPoll();
    await vi.runAllTicks();
    await poller.stop();
  });

  it('stop() resolves via stopTimeoutMs race even when poll() hangs indefinitely', async () => {
    const listener: PollListener<null> = {
      intervalMs: 60_000,
      poll: vi.fn().mockImplementation(async () => new Promise<never>(() => {})),
    };
    const poller = makePoller(listener);
    void poller.start(); // first tick blocks forever
    await vi.runAllTicks();

    const stopP = poller.stop();
    // advance past stopTimeoutMs (500ms in makePoller opts)
    await vi.advanceTimersByTimeAsync(600);
    await expect(stopP).resolves.toBeUndefined();
  });

  it('a throwing poll is caught and metered; cursor is unchanged; loop survives', async () => {
    let callIdx = 0;
    const cursors: (unknown | null)[] = [];
    const listener: PollListener<number> = {
      intervalMs: 200,
      poll: vi.fn().mockImplementation(async (_ctx, cursor) => {
        callIdx++;
        cursors.push(cursor);
        if (callIdx === 1) throw new Error('poll-failed');
        return { items: [], nextCursor: (cursor ?? 0) + 1 };
      }),
    };
    const { pollMetrics: m } = await import('./poll-metrics');

    const poller = makePoller(listener);
    const sp = poller.start();
    await vi.runAllTicks();
    await sp; // first tick throws, caught

    await vi.advanceTimersByTimeAsync(200); // second tick succeeds
    await poller.stop();

    // cursor into tick 2 must still be null (tick 1 failed, cursor not advanced)
    expect(cursors[1]).toBeNull();
    expect(m.pollTick.add).toHaveBeenCalledWith(1, {
      source_type: FAKE_SOURCE.sourceType,
      result: 'error',
    });
  });

  it('a timed-out poll is caught and metered as result=timeout', async () => {
    const listener: PollListener<null> = {
      intervalMs: 60_000,
      poll: vi.fn().mockImplementation(async () => new Promise<never>(() => {})),
    };
    const { pollMetrics: m } = await import('./poll-metrics');

    const poller = makePoller(listener, { tickTimeoutMs: 200, stopTimeoutMs: 500 });
    const sp = poller.start();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(200); // trigger tick timeout
    await sp; // runTick resolved after timeout

    expect(m.pollTick.add).toHaveBeenCalledWith(1, {
      source_type: FAKE_SOURCE.sourceType,
      result: 'timeout',
    });

    await poller.stop();
  });
});
