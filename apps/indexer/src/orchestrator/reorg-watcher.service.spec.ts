import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@libs/chain', () => ({
  chainMetrics: {
    reorgEvent: { add: vi.fn() },
    orphanedEvents: { add: vi.fn() },
    reorgTruncated: { add: vi.fn() },
  },
}));

import { chainMetrics } from '@libs/chain';
import { ReorgWatcherService } from './reorg-watcher.service';

function makeReorgSignal(
  overrides: Partial<{
    chainId: string;
    detectedAt: Date;
    observedAt: Date;
    divergenceBlockNumber: bigint;
    orphanedBlockHashes: (string | null)[];
    canonicalBlockHashes: (string | null)[];
    truncated: boolean;
    chainShrunk: boolean;
  }> = {},
) {
  return {
    chainId: '0x1',
    detectedAt: new Date('2026-01-01T00:00:00Z'),
    observedAt: new Date('2026-01-01T00:00:00Z'),
    divergenceBlockNumber: 100n,
    orphanedBlockHashes: ['0xaaa', '0xbbb'] as (string | null)[],
    canonicalBlockHashes: ['0xccc', '0xddd'] as (string | null)[],
    truncated: false,
    chainShrunk: false,
    ...overrides,
  };
}

function makeRegistry(
  chains: Array<{
    reorgDetector: { onReorg: ReturnType<typeof vi.fn> };
    chainCfg: { name: string };
  }>,
) {
  const whenReady = vi.fn().mockResolvedValue(undefined);
  const allActive = vi.fn().mockReturnValue(chains);
  return { whenReady, allActive };
}

function makeRepo(result = { reorgEventId: 'evt-uuid', orphanedRowCount: 2 }) {
  return {
    writeReorgEventAndOrphan: vi.fn().mockResolvedValue(result),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReorgWatcherService', () => {
  it('#1 — onApplicationBootstrap: awaits whenReady and registers onReorg on every chain', async () => {
    const detector1 = { onReorg: vi.fn().mockReturnValue(() => {}) };
    const detector2 = { onReorg: vi.fn().mockReturnValue(() => {}) };
    const registry = makeRegistry([
      { reorgDetector: detector1, chainCfg: { name: 'ethereum' } },
      { reorgDetector: detector2, chainCfg: { name: 'polygon' } },
    ]);
    const repo = makeRepo();
    const svc = new ReorgWatcherService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    expect(registry.whenReady).toHaveBeenCalledTimes(1);
    expect(detector1.onReorg).toHaveBeenCalledTimes(1);
    expect(detector2.onReorg).toHaveBeenCalledTimes(1);
  });

  it('#2 — reorg signal dispatched → repo called with correctly mapped fields', async () => {
    let capturedListener: ((sig: ReturnType<typeof makeReorgSignal>) => void) | null = null;
    const detector = {
      onReorg: vi.fn().mockImplementation((fn: typeof capturedListener) => {
        capturedListener = fn;
        return () => {};
      }),
    };
    const registry = makeRegistry([{ reorgDetector: detector, chainCfg: { name: 'ethereum' } }]);
    const repo = makeRepo();
    const svc = new ReorgWatcherService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    const signal = makeReorgSignal();
    await capturedListener!(signal);

    expect(repo.writeReorgEventAndOrphan).toHaveBeenCalledWith({
      chainId: '0x1',
      detectedAt: signal.detectedAt,
      divergenceBlockNumber: 100n,
      orphanedBlockHashes: ['0xaaa', '0xbbb'],
      canonicalBlockHashes: ['0xccc', '0xddd'],
      notes: null,
    });
  });

  it('#3 — null entries in orphanedBlockHashes are dropped before repo call', async () => {
    let capturedListener: ((sig: ReturnType<typeof makeReorgSignal>) => void) | null = null;
    const detector = {
      onReorg: vi.fn().mockImplementation((fn: typeof capturedListener) => {
        capturedListener = fn;
        return () => {};
      }),
    };
    const registry = makeRegistry([{ reorgDetector: detector, chainCfg: { name: 'ethereum' } }]);
    const repo = makeRepo();
    const svc = new ReorgWatcherService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    const signal = makeReorgSignal({ orphanedBlockHashes: [null, '0xaaa', null, '0xbbb'] });
    await capturedListener!(signal);

    const call = repo.writeReorgEventAndOrphan.mock.calls[0]![0] as {
      orphanedBlockHashes: string[];
    };
    expect(call.orphanedBlockHashes).toEqual(['0xaaa', '0xbbb']);
  });

  it('#4 — truncated signal: reorgTruncated counter increments; notes = "truncated"', async () => {
    let capturedListener: ((sig: ReturnType<typeof makeReorgSignal>) => void) | null = null;
    const detector = {
      onReorg: vi.fn().mockImplementation((fn: typeof capturedListener) => {
        capturedListener = fn;
        return () => {};
      }),
    };
    const registry = makeRegistry([{ reorgDetector: detector, chainCfg: { name: 'ethereum' } }]);
    const repo = makeRepo();
    const svc = new ReorgWatcherService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    const signal = makeReorgSignal({ truncated: true });
    await capturedListener!(signal);

    expect(vi.mocked(chainMetrics.reorgTruncated.add)).toHaveBeenCalledWith(1, { chain_id: '0x1' });
    const call = repo.writeReorgEventAndOrphan.mock.calls[0]![0] as { notes: string };
    expect(call.notes).toBe('truncated');
  });

  it('#5 — chainShrunk signal: notes contains "chain_shrunk"', async () => {
    let capturedListener: ((sig: ReturnType<typeof makeReorgSignal>) => void) | null = null;
    const detector = {
      onReorg: vi.fn().mockImplementation((fn: typeof capturedListener) => {
        capturedListener = fn;
        return () => {};
      }),
    };
    const registry = makeRegistry([{ reorgDetector: detector, chainCfg: { name: 'ethereum' } }]);
    const repo = makeRepo();
    const svc = new ReorgWatcherService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    const signal = makeReorgSignal({ chainShrunk: true });
    await capturedListener!(signal);

    const call = repo.writeReorgEventAndOrphan.mock.calls[0]![0] as { notes: string };
    expect(call.notes).toContain('chain_shrunk');
  });

  it('#6 — repo throws → handler logs error, does NOT rethrow', async () => {
    let capturedListener: ((sig: ReturnType<typeof makeReorgSignal>) => void) | null = null;
    const detector = {
      onReorg: vi.fn().mockImplementation((fn: typeof capturedListener) => {
        capturedListener = fn;
        return () => {};
      }),
    };
    const registry = makeRegistry([{ reorgDetector: detector, chainCfg: { name: 'ethereum' } }]);
    const repo = { writeReorgEventAndOrphan: vi.fn().mockRejectedValue(new Error('db down')) };
    const svc = new ReorgWatcherService(registry as never, repo as never);

    await svc.onApplicationBootstrap();

    const signal = makeReorgSignal();
    await expect(capturedListener!(signal)).resolves.toBeUndefined();
  });

  it('#7 — onApplicationShutdown: invokes every unsubscribe fn', async () => {
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    const detector1 = { onReorg: vi.fn().mockReturnValue(unsub1) };
    const detector2 = { onReorg: vi.fn().mockReturnValue(unsub2) };
    const registry = makeRegistry([
      { reorgDetector: detector1, chainCfg: { name: 'ethereum' } },
      { reorgDetector: detector2, chainCfg: { name: 'polygon' } },
    ]);
    const repo = makeRepo();
    const svc = new ReorgWatcherService(registry as never, repo as never);

    await svc.onApplicationBootstrap();
    await svc.onApplicationShutdown();

    expect(unsub1).toHaveBeenCalledTimes(1);
    expect(unsub2).toHaveBeenCalledTimes(1);
  });

  it('#8 — idempotent shutdown: unsubscribes only once even if called twice', async () => {
    const unsub = vi.fn();
    const detector = { onReorg: vi.fn().mockReturnValue(unsub) };
    const registry = makeRegistry([{ reorgDetector: detector, chainCfg: { name: 'ethereum' } }]);
    const repo = makeRepo();
    const svc = new ReorgWatcherService(registry as never, repo as never);

    await svc.onApplicationBootstrap();
    await svc.onApplicationShutdown();
    await svc.onApplicationShutdown();

    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
