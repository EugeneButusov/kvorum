import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllProvidersFailedError } from '@libs/chain';
import { StateReconcilerService } from './state-reconciler.service';

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
    if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' };
    if (method === 'eth_call')
      return '0x0000000000000000000000000000000000000000000000000000000000000003';
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

describe('StateReconcilerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it('skips when head is unavailable', async () => {
    const { registry } = makeRegistry(null);
    const repo = makeRepo();
    const svc = new StateReconcilerService(registry as never, repo as never);

    await svc.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(repo.findStaleForReconciliation).not.toHaveBeenCalled();
  });

  it('reconciles candidate row when stale proposal is returned', async () => {
    const { registry, ctx } = makeRegistry(2000n);
    const repo = makeRepo();
    repo.findStaleForReconciliation.mockResolvedValue([
      {
        id: 'proposal-1',
        source_id: '42',
        source_type: 'compound_governor_bravo',
        chain_id: '0x1',
        governor_address: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
        state: 'pending',
        voting_starts_block: '100',
        voting_ends_block: '200',
        timelock_eta: null,
      },
    ]);

    const svc = new StateReconcilerService(registry as never, repo as never);
    await svc.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(repo.reconcileState).toHaveBeenCalledTimes(1);
  });

  it('treats executed/queued/canceled mismatch as missed_event without writes', async () => {
    const { registry, ctx } = makeRegistry(2000n);
    const repo = makeRepo();
    repo.findStaleForReconciliation.mockResolvedValue([
      {
        id: 'proposal-1',
        source_id: '42',
        source_type: 'compound_governor_bravo',
        chain_id: '0x1',
        governor_address: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
        state: 'pending',
        voting_starts_block: '100',
        voting_ends_block: '200',
        timelock_eta: null,
      },
    ]);
    ctx.client.send = vi.fn(async (method: string) => {
      if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' };
      if (method === 'eth_call')
        return '0x0000000000000000000000000000000000000000000000000000000000000007';
      return null;
    });

    const svc = new StateReconcilerService(registry as never, repo as never);
    await svc.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(repo.reconcileState).not.toHaveBeenCalled();
  });

  it('escalates repeated rpc_failed for same proposal id', async () => {
    process.env['STATE_RECONCILE_RPC_FAIL_ESCALATE'] = '2';
    const { registry, ctx } = makeRegistry(2000n);
    const repo = makeRepo();
    repo.findStaleForReconciliation.mockResolvedValue([
      {
        id: 'proposal-1',
        source_id: '42',
        source_type: 'compound_governor_bravo',
        chain_id: '0x1',
        governor_address: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
        state: 'pending',
        voting_starts_block: '100',
        voting_ends_block: '200',
        timelock_eta: null,
      },
    ]);
    ctx.client.send = vi.fn(async (method: string) => {
      if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' };
      if (method === 'eth_call') {
        throw new AllProvidersFailedError('0x1', []);
      }
      return null;
    });

    const svc = new StateReconcilerService(registry as never, repo as never);
    await svc.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(30_000);
    delete process.env['STATE_RECONCILE_RPC_FAIL_ESCALATE'];

    expect(repo.reconcileState).not.toHaveBeenCalled();
  });

  it('skips expired correction when eta is missing (expired_no_eta path)', async () => {
    const { registry, ctx } = makeRegistry(2000n);
    const repo = makeRepo();
    repo.findStaleForReconciliation.mockResolvedValue([
      {
        id: 'proposal-1',
        source_id: '42',
        source_type: 'compound_governor_bravo',
        chain_id: '0x1',
        governor_address: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
        state: 'queued',
        voting_starts_block: '100',
        voting_ends_block: '200',
        timelock_eta: null,
      },
    ]);
    ctx.client.send = vi.fn(async (method: string) => {
      if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' };
      if (method === 'eth_call')
        return '0x0000000000000000000000000000000000000000000000000000000000000006';
      return null;
    });

    const svc = new StateReconcilerService(registry as never, repo as never);
    await svc.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(repo.reconcileState).not.toHaveBeenCalled();
  });

  it('records guard_skipped when optimistic reconcile update returns 0', async () => {
    const { registry } = makeRegistry(2000n);
    const repo = makeRepo();
    repo.findStaleForReconciliation.mockResolvedValue([
      {
        id: 'proposal-1',
        source_id: '42',
        source_type: 'compound_governor_bravo',
        chain_id: '0x1',
        governor_address: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
        state: 'pending',
        voting_starts_block: '100',
        voting_ends_block: '200',
        timelock_eta: null,
      },
    ]);
    repo.reconcileState.mockResolvedValue(0);

    const svc = new StateReconcilerService(registry as never, repo as never);
    await svc.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(repo.reconcileState).toHaveBeenCalledTimes(1);
  });
});
