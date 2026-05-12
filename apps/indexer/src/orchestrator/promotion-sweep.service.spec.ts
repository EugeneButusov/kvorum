import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@libs/chain', () => ({
  chainMetrics: {
    promotionSweepDuration: { record: vi.fn() },
  },
}));

import { chainMetrics } from '@libs/chain';
import { PromotionSweepService } from './promotion-sweep.service';

function makeHead(blockNumber: bigint) {
  return {
    chainId: '0x1',
    blockNumber,
    blockHash: '0xabc',
    parentHash: '0xdef',
    timestamp: 0n,
    observedAt: new Date(),
  };
}

function makeChainCtx(
  chainId: string,
  chainName: string,
  reorgHorizon: number,
  lastHead: ReturnType<typeof makeHead> | null,
) {
  return {
    chainCfg: { chainId, name: chainName, reorgHorizon, providers: [] },
    headTracker: { getLastHead: vi.fn().mockReturnValue(lastHead) },
    client: {},
    reorgDetector: {},
  };
}

function makeRegistry(chains: ReturnType<typeof makeChainCtx>[]) {
  return {
    whenReady: vi.fn().mockResolvedValue(undefined),
    allActive: vi.fn().mockReturnValue(chains),
  };
}

function makeRepo(promotedCount = 0) {
  return {
    promotePending: vi.fn().mockResolvedValue(promotedCount),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PromotionSweepService', () => {
  it('#1 — bootstrap: runs one tick immediately, then schedules setInterval at 30 000 ms', async () => {
    const chain = makeChainCtx('0x1', 'ethereum', 12, makeHead(1000n));
    const registry = makeRegistry([chain]);
    const repo = makeRepo(0);
    const svc = new PromotionSweepService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    // immediate tick
    expect(repo.promotePending).toHaveBeenCalledTimes(1);

    // advance 30s to trigger setInterval
    await vi.advanceTimersByTimeAsync(30_000);
    expect(repo.promotePending).toHaveBeenCalledTimes(2);
  });

  it('#2 — tick with no chains: no-op, no exception', async () => {
    const registry = makeRegistry([]);
    const repo = makeRepo();
    const svc = new PromotionSweepService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    expect(repo.promotePending).not.toHaveBeenCalled();
  });

  it('#3 — tick with headTracker.getLastHead() = null: skips, no promotePending call', async () => {
    const chain = makeChainCtx('0x1', 'ethereum', 12, null);
    const registry = makeRegistry([chain]);
    const repo = makeRepo();
    const svc = new PromotionSweepService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    expect(repo.promotePending).not.toHaveBeenCalled();
  });

  it('#4 — tick with head 1000, reorgHorizon 12: calls promotePending(1, 988n)', async () => {
    const chain = makeChainCtx('0x1', 'ethereum', 12, makeHead(1000n));
    const registry = makeRegistry([chain]);
    const repo = makeRepo();
    const svc = new PromotionSweepService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    expect(repo.promotePending).toHaveBeenCalledWith('0x1', 988n);
  });

  it('#5 — tick with two chains: calls promotePending once per chain with correct args', async () => {
    const chainA = makeChainCtx('0x1', 'ethereum', 12, makeHead(1000n));
    const chainB = makeChainCtx('0x89', 'polygon', 20, makeHead(5000n));
    const registry = makeRegistry([chainA, chainB]);
    const repo = makeRepo();
    const svc = new PromotionSweepService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    expect(repo.promotePending).toHaveBeenCalledTimes(2);
    expect(repo.promotePending).toHaveBeenCalledWith('0x1', 988n);
    expect(repo.promotePending).toHaveBeenCalledWith('0x89', 4980n);
  });

  it('#6 — promotePending throws → caught, sweep_failed logged, next chain still processed', async () => {
    const chainA = makeChainCtx('0x1', 'ethereum', 12, makeHead(1000n));
    const chainB = makeChainCtx('0x89', 'polygon', 12, makeHead(2000n));
    const registry = makeRegistry([chainA, chainB]);
    const repo = {
      promotePending: vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(5),
    };
    const svc = new PromotionSweepService(registry as never, repo as never);

    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(repo.promotePending).toHaveBeenCalledTimes(2);
  });

  it('#7 — histogram observes one sample per chain per tick with hex chain_id label', async () => {
    const chain = makeChainCtx('0x1', 'ethereum', 12, makeHead(1000n));
    const registry = makeRegistry([chain]);
    const repo = makeRepo(3);
    const svc = new PromotionSweepService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    expect(vi.mocked(chainMetrics.promotionSweepDuration.record)).toHaveBeenCalledWith(
      expect.any(Number),
      { chain_id: '0x1' },
    );
  });

  it('#8 — shutdown: clearInterval called; subsequent ticks do not fire', async () => {
    const chain = makeChainCtx('0x1', 'ethereum', 12, makeHead(1000n));
    const registry = makeRegistry([chain]);
    const repo = makeRepo();
    const svc = new PromotionSweepService(registry as never, repo as never);

    await svc.onApplicationBootstrap();
    const callsAfterBoot = repo.promotePending.mock.calls.length;

    await svc.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(repo.promotePending).toHaveBeenCalledTimes(callsAfterBoot);
  });

  it('#9 — head below horizon (block 5, horizon 12): sweep skipped for this chain', async () => {
    const chain = makeChainCtx('0x1', 'ethereum', 12, makeHead(5n));
    const registry = makeRegistry([chain]);
    const repo = makeRepo();
    const svc = new PromotionSweepService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    expect(repo.promotePending).not.toHaveBeenCalled();
  });
});
