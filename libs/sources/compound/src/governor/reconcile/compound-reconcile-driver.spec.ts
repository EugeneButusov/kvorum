import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllProvidersFailedError } from '@libs/chain';
import type { ReconcileDriverMetrics } from './compound-reconcile-driver';
import { CompoundReconcileDriver } from './compound-reconcile-driver';

function makeReconciler(sourceTypes = ['compound_governor_bravo', 'compound_governor_oz']) {
  return {
    sourceTypes,
    reconcileRow: vi.fn().mockResolvedValue({ outcome: 'already_consistent' }),
  };
}

function makeProposals() {
  return {
    findStaleForReconciliation: vi.fn().mockResolvedValue([]),
    markReconcileChecked: vi.fn().mockResolvedValue(undefined),
    reconcileState: vi.fn().mockResolvedValue(1),
  };
}

function makeMetrics(): ReconcileDriverMetrics {
  return {
    recordBacklog: vi.fn(),
    recordBatchSaturated: vi.fn(),
    recordOutcome: vi.fn(),
    recordRpcFailEscalated: vi.fn(),
    recordTickDurationSeconds: vi.fn(),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeBound(chainId = '0x1', confirmedThresholdBlock = '1988', recheckGapBlocks = 600) {
  const send = vi.fn(async (method: string) => {
    if (method === 'eth_call')
      return '0x0000000000000000000000000000000000000000000000000000000000000003';
    if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' };
    return null;
  });
  return { chainId, confirmedThresholdBlock, recheckGapBlocks, client: { send } };
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p1',
    source_id: '42',
    source_type: 'compound_governor_bravo',
    chain_id: '0x1',
    governor_address: '0xgov',
    state: 'pending',
    voting_starts_block: '100',
    voting_ends_block: '200',
    queued_at_block: null,
    ...overrides,
  };
}

describe('CompoundReconcileDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('skips when already inFlight', async () => {
    const proposals = makeProposals();
    let resolveFirst!: () => void;
    proposals.findStaleForReconciliation.mockReturnValue(
      new Promise<never[]>((r) => {
        resolveFirst = () => r([]);
      }),
    );

    const driver = new CompoundReconcileDriver(
      makeReconciler() as never,
      proposals as never,
      makeMetrics(),
      makeLogger() as never,
    );
    const bound = makeBound();

    const first = driver.onConfirmedHeads([bound]);
    const second = driver.onConfirmedHeads([bound]);
    resolveFirst();
    await Promise.all([first, second]);

    expect(proposals.findStaleForReconciliation).toHaveBeenCalledTimes(1);
  });

  it('returns early when bounds is empty', async () => {
    const proposals = makeProposals();
    const driver = new CompoundReconcileDriver(
      makeReconciler() as never,
      proposals as never,
      makeMetrics(),
      makeLogger() as never,
    );

    await driver.onConfirmedHeads([]);

    expect(proposals.findStaleForReconciliation).not.toHaveBeenCalled();
  });

  it('queries with correct sourceTypes and bounds', async () => {
    const proposals = makeProposals();
    const driver = new CompoundReconcileDriver(
      makeReconciler() as never,
      proposals as never,
      makeMetrics(),
      makeLogger() as never,
    );
    const bound = makeBound('0x1', '1988');

    await driver.onConfirmedHeads([bound]);

    expect(proposals.findStaleForReconciliation).toHaveBeenCalledWith(
      ['compound_governor_bravo', 'compound_governor_oz'],
      [
        {
          chainId: '0x1',
          confirmedThresholdBlock: '1988',
          recheckGapBlocks: 600,
          client: bound.client,
        },
      ],
      expect.any(Number),
    );
  });

  it('records backlog and tick duration', async () => {
    const proposals = makeProposals();
    const metrics = makeMetrics();
    const driver = new CompoundReconcileDriver(
      makeReconciler() as never,
      proposals as never,
      metrics,
      makeLogger() as never,
    );

    await driver.onConfirmedHeads([makeBound()]);

    expect(metrics.recordBacklog).toHaveBeenCalledWith(0);
    expect(metrics.recordTickDurationSeconds).toHaveBeenCalledWith(expect.any(Number));
  });

  it('records batch_saturated when row count equals batch size', async () => {
    vi.stubEnv('COMPOUND_STATE_RECONCILE_BATCH_SIZE', '2');
    const proposals = makeProposals();
    proposals.findStaleForReconciliation.mockResolvedValue([makeRow(), makeRow({ id: 'p2' })]);
    const metrics = makeMetrics();
    const reconciler = makeReconciler();
    reconciler.reconcileRow.mockResolvedValue({ outcome: 'already_consistent' });

    const driver = new CompoundReconcileDriver(
      reconciler as never,
      proposals as never,
      metrics,
      makeLogger() as never,
    );

    await driver.onConfirmedHeads([makeBound()]);

    expect(metrics.recordBatchSaturated).toHaveBeenCalledOnce();
  });

  it('records corrected outcome with from/to state', async () => {
    const proposals = makeProposals();
    proposals.findStaleForReconciliation.mockResolvedValue([makeRow()]);
    const metrics = makeMetrics();
    const reconciler = makeReconciler();
    reconciler.reconcileRow.mockResolvedValue({
      outcome: 'corrected',
      fromState: 'pending',
      toState: 'defeated',
    });

    const driver = new CompoundReconcileDriver(
      reconciler as never,
      proposals as never,
      metrics,
      makeLogger() as never,
    );

    await driver.onConfirmedHeads([makeBound()]);

    expect(metrics.recordOutcome).toHaveBeenCalledWith({
      source_type: 'compound_governor_bravo',
      outcome: 'corrected',
      from_state: 'pending',
      to_state: 'defeated',
    });
  });

  it('records rpc_failed and escalates after threshold', async () => {
    vi.stubEnv('COMPOUND_STATE_RECONCILE_RPC_FAIL_ESCALATE', '2');
    const proposals = makeProposals();
    proposals.findStaleForReconciliation.mockResolvedValue([makeRow()]);
    const metrics = makeMetrics();
    const reconciler = makeReconciler();
    reconciler.reconcileRow.mockRejectedValue(new AllProvidersFailedError([]));

    const driver = new CompoundReconcileDriver(
      reconciler as never,
      proposals as never,
      metrics,
      makeLogger() as never,
    );

    await driver.onConfirmedHeads([makeBound()]);
    await driver.onConfirmedHeads([makeBound()]);

    expect(metrics.recordRpcFailEscalated).toHaveBeenCalledOnce();
  });

  it('records decode_failed for non-transient errors', async () => {
    const proposals = makeProposals();
    proposals.findStaleForReconciliation.mockResolvedValue([makeRow()]);
    const metrics = makeMetrics();
    const reconciler = makeReconciler();
    reconciler.reconcileRow.mockRejectedValue(new Error('abi decode failed'));

    const driver = new CompoundReconcileDriver(
      reconciler as never,
      proposals as never,
      metrics,
      makeLogger() as never,
    );

    await driver.onConfirmedHeads([makeBound()]);

    expect(metrics.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'decode_failed' }),
    );
  });

  it('skips row when no matching bound for its chain', async () => {
    const proposals = makeProposals();
    proposals.findStaleForReconciliation.mockResolvedValue([makeRow({ chain_id: '0x89' })]);
    const reconciler = makeReconciler();

    const driver = new CompoundReconcileDriver(
      reconciler as never,
      proposals as never,
      makeMetrics(),
      makeLogger() as never,
    );

    await driver.onConfirmedHeads([makeBound('0x1')]);

    expect(reconciler.reconcileRow).not.toHaveBeenCalled();
  });
});
