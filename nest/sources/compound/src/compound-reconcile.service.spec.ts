import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllProvidersFailedError } from '@libs/chain';
import { CompoundReconcileService } from './compound-reconcile.service';

vi.mock('./state-reconciler-metrics', () => ({
  stateReconcilerMetrics: {
    stateReconcile: { add: vi.fn() },
    stateReconcileRpcFailEscalated: { add: vi.fn() },
    stateReconcileBacklog: { record: vi.fn() },
    stateReconcileBatchSaturated: { add: vi.fn() },
    stateReconcileRpcCalls: { add: vi.fn() },
    stateReconcileTickDurationSeconds: { record: vi.fn() },
  },
}));

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

function makeRegistry(headBlock: bigint | null = 2000n) {
  const send = vi.fn(async (method: string) => {
    if (method === 'eth_call')
      return '0x0000000000000000000000000000000000000000000000000000000000000003';
    if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' };
    return null;
  });

  const ctx = {
    chainCfg: { chainId: '0x1', name: 'ethereum', reorgHorizon: 12, providers: [] },
    headTracker: {
      getLastHead: vi.fn().mockReturnValue(headBlock === null ? null : makeHead(headBlock)),
    },
    client: { send },
    reorgDetector: {},
    proxyResolver: {},
  };

  return {
    ctx,
    registry: {
      allActive: vi.fn().mockReturnValue([ctx]),
      peek: vi.fn().mockReturnValue(ctx),
    },
  };
}

function makeRepo() {
  return {
    findStaleForReconciliation: vi.fn().mockResolvedValue([]),
    markReconcileChecked: vi.fn().mockResolvedValue(1),
    reconcileState: vi.fn().mockResolvedValue(1),
  };
}

describe('CompoundReconcileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('skips tick when head is null', async () => {
    const { registry } = makeRegistry(null);
    const repo = makeRepo();
    const svc = new CompoundReconcileService(registry as never, repo as never);

    await svc.onApplicationBootstrap();
    await svc.onApplicationShutdown();

    expect(repo.findStaleForReconciliation).not.toHaveBeenCalled();
  });

  it('skips tick when head is below reorgHorizon', async () => {
    const { registry } = makeRegistry(5n);
    const repo = makeRepo();
    const svc = new CompoundReconcileService(registry as never, repo as never);

    await svc.onApplicationBootstrap();
    await svc.onApplicationShutdown();

    expect(repo.findStaleForReconciliation).not.toHaveBeenCalled();
  });

  it('passes confirmedThresholdBlock = head - reorgHorizon to repository', async () => {
    const { registry } = makeRegistry(2000n);
    const repo = makeRepo();
    const svc = new CompoundReconcileService(registry as never, repo as never);

    await svc.onApplicationBootstrap();
    await svc.onApplicationShutdown();

    expect(repo.findStaleForReconciliation).toHaveBeenCalledWith(
      ['compound_governor_bravo'],
      [{ chainId: '0x1', confirmedThresholdBlock: '1988' }],
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('re-entrancy guard prevents overlapping ticks', async () => {
    const { registry } = makeRegistry(2000n);
    const repo = makeRepo();
    let resolveTick!: () => void;
    repo.findStaleForReconciliation.mockReturnValue(
      new Promise<never[]>((r) => {
        resolveTick = () => r([]);
      }),
    );

    const svc = new CompoundReconcileService(registry as never, repo as never);

    const tick1 = svc['tick']();
    const tick2 = svc['tick']();
    resolveTick();
    await Promise.all([tick1, tick2]);

    expect(repo.findStaleForReconciliation).toHaveBeenCalledTimes(1);
  });

  it('records rpc_failed and escalates after threshold', async () => {
    vi.stubEnv('STATE_RECONCILE_RPC_FAIL_ESCALATE', '2');
    const { registry, ctx } = makeRegistry(2000n);
    const repo = makeRepo();
    const row = {
      id: 'p1',
      source_id: '42',
      source_type: 'compound_governor_bravo',
      chain_id: '0x1',
      governor_address: '0xgov',
      state: 'pending',
      voting_starts_block: '100',
      voting_ends_block: '200',
      queued_block: null,
    };
    repo.findStaleForReconciliation.mockResolvedValue([row]);
    ctx.client.send.mockRejectedValue(new AllProvidersFailedError([]));

    const svc = new CompoundReconcileService(registry as never, repo as never);
    await svc['tick']();
    await svc['tick']();

    const { stateReconcilerMetrics } = await import('./state-reconciler-metrics');
    expect(stateReconcilerMetrics.stateReconcileRpcFailEscalated.add).toHaveBeenCalledOnce();
  });
});
