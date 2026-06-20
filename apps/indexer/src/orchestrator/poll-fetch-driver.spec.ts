import { vi, describe, it, expect } from 'vitest';
import type { IngestSpec, SourceContext, QueueProducerPort } from '@sources/core';
import { PollFetchDriver } from './poll-fetch-driver';

vi.mock('./poll-metrics', () => ({
  pollMetrics: {
    pollTick: { add: vi.fn() },
    pollItemsEnqueued: { add: vi.fn() },
    pollLastSuccess: { record: vi.fn() },
  },
}));

const FAKE_CTX: SourceContext = {
  daoSourceId: 'src-1',
  sourceType: 'snapshot' as never,
  chainId: 'off-chain',
  sourceLabel: 'snapshot' as never,
};

const STUB_PORT: QueueProducerPort = {
  loadCursor: vi.fn().mockResolvedValue(null),
  commitTick: vi.fn().mockResolvedValue(undefined),
};

function makeSpec(intervalMs = 60_000): Extract<IngestSpec, { kind: 'poll' }> {
  return {
    kind: 'poll',
    listener: {
      intervalMs,
      poll: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    },
  };
}

describe('PollFetchDriver', () => {
  it('has kind "poll"', () => {
    const driver = new PollFetchDriver(STUB_PORT);
    expect(driver.kind).toBe('poll');
  });

  it('start() returns a handle whose stop() resolves cleanly', async () => {
    vi.useFakeTimers();
    const driver = new PollFetchDriver(STUB_PORT);
    const spec = makeSpec();
    const handle = await driver.start(spec, FAKE_CTX);

    expect(handle).toHaveProperty('stop');
    await expect(handle.stop()).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it('two start() calls for different sources each get their own poller', async () => {
    vi.useFakeTimers();
    const pollA = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const pollB = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const driver = new PollFetchDriver(STUB_PORT);

    const specA: Extract<IngestSpec, { kind: 'poll' }> = {
      kind: 'poll',
      listener: { intervalMs: 60_000, poll: pollA },
    };
    const specB: Extract<IngestSpec, { kind: 'poll' }> = {
      kind: 'poll',
      listener: { intervalMs: 60_000, poll: pollB },
    };

    const ctxB = { ...FAKE_CTX, daoSourceId: 'src-2' };
    const handleA = await driver.start(specA, FAKE_CTX);
    const handleB = await driver.start(specB, ctxB);

    // Each listener is called independently (immediate first tick)
    expect(pollA).toHaveBeenCalledTimes(1);
    expect(pollB).toHaveBeenCalledTimes(1);

    await handleA.stop();
    await handleB.stop();
    vi.useRealTimers();
  });
});
