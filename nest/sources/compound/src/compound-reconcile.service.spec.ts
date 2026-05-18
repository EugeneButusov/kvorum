import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompoundReconcileService } from './compound-reconcile.service';

vi.mock('./state-reconciler-metrics', () => ({
  buildDriverMetrics: () => ({
    recordBacklog: vi.fn(),
    recordBatchSaturated: vi.fn(),
    recordOutcome: vi.fn(),
    recordRpcFailEscalated: vi.fn(),
    recordTickDurationSeconds: vi.fn(),
  }),
  stateReconcilerMetrics: {
    stateReconcile: { add: vi.fn() },
    stateReconcileRpcFailEscalated: { add: vi.fn() },
    stateReconcileBacklog: { record: vi.fn() },
    stateReconcileBatchSaturated: { add: vi.fn() },
    stateReconcileRpcCalls: { add: vi.fn() },
    stateReconcileTickDurationSeconds: { record: vi.fn() },
  },
}));

type HeadListener = (head: { blockNumber: bigint }) => void | Promise<void>;

function makeRegistry() {
  const listeners: HeadListener[] = [];
  const send = vi.fn(async () => null);
  const ctx = {
    chainCfg: { chainId: '0x1', reorgHorizon: 12 },
    headTracker: {
      onHead: vi.fn((listener: HeadListener) => {
        listeners.push(listener);
        return () => {};
      }),
    },
    client: { send },
  };
  return {
    ctx,
    registry: { allActive: vi.fn().mockReturnValue([ctx]) },
    emitHead: (blockNumber: bigint) => listeners.forEach((l) => l({ blockNumber })),
  };
}

function makeRepo() {
  return {
    findStaleForReconciliation: vi.fn().mockResolvedValue([]),
    markReconcileChecked: vi.fn().mockResolvedValue(undefined),
    reconcileState: vi.fn().mockResolvedValue(1),
  };
}

describe('CompoundReconcileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes to onHead for each active chain on bootstrap', async () => {
    const { registry, ctx } = makeRegistry();
    const svc = new CompoundReconcileService(registry as never, makeRepo() as never);

    await svc.onApplicationBootstrap();

    expect(ctx.headTracker.onHead).toHaveBeenCalledOnce();
  });

  it('does not trigger driver for heads below reorgHorizon', async () => {
    const { registry, emitHead } = makeRegistry();
    const repo = makeRepo();
    const svc = new CompoundReconcileService(registry as never, repo as never);

    await svc.onApplicationBootstrap();
    emitHead(5n); // below reorgHorizon of 12

    expect(repo.findStaleForReconciliation).not.toHaveBeenCalled();
  });

  it('passes confirmedThresholdBlock = head - reorgHorizon to driver', async () => {
    const { registry, emitHead } = makeRegistry();
    const repo = makeRepo();
    const svc = new CompoundReconcileService(registry as never, repo as never);

    await svc.onApplicationBootstrap();
    emitHead(2000n);

    await vi.waitFor(() => expect(repo.findStaleForReconciliation).toHaveBeenCalled());
    expect(repo.findStaleForReconciliation).toHaveBeenCalledWith(
      ['compound_governor_bravo'],
      [expect.objectContaining({ chainId: '0x1', confirmedThresholdBlock: '1988' })],
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('unsubscribes all listeners on shutdown', async () => {
    const listeners: Array<() => void> = [];
    const ctx = {
      chainCfg: { chainId: '0x1', reorgHorizon: 12 },
      headTracker: {
        onHead: vi.fn((listener: HeadListener) => {
          const unsub = vi.fn();
          listeners.push(unsub);
          void listener; // register but capture unsub
          return unsub;
        }),
      },
      client: { send: vi.fn() },
    };
    const registry = { allActive: vi.fn().mockReturnValue([ctx]) };
    const svc = new CompoundReconcileService(registry as never, makeRepo() as never);

    await svc.onApplicationBootstrap();
    await svc.onApplicationShutdown();

    expect(listeners).toHaveLength(1);
    expect(listeners[0]).toHaveBeenCalledOnce();
  });
});
