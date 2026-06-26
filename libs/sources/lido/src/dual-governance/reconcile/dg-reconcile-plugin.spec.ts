import { afterEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import { createLidoDualGovernanceReconcilePlugin } from './dg-reconcile-plugin';

const NOOP_METRICS = {
  recordBacklog: () => undefined,
  recordBatchSaturated: () => undefined,
  recordOutcome: () => undefined,
  recordRpcFailEscalated: () => undefined,
  recordTickDurationSeconds: () => undefined,
};

const FAKE_CLIENT = { send: vi.fn() };
const DG = '0x' + 'c1'.repeat(20);
const TL = '0x' + 'ce'.repeat(20);

function makeChainCfg(overrides: Record<string, unknown> = {}) {
  return { chainId: '0x1', headLag: 12, blocksPerMinute: 5, ...overrides };
}

function makeDeps() {
  return {
    reconcile: { findStaleForReconciliation: vi.fn().mockResolvedValue([]) },
    metrics: NOOP_METRICS,
    logger: silentLogger,
  };
}

afterEach(() => {
  delete process.env['LIDO_DG_RECONCILE_RECHECK_GAP_SECONDS'];
});

describe('createLidoDualGovernanceReconcilePlugin', () => {
  it('declares the dual_governance_reconcile ingester contract', () => {
    const plugin = createLidoDualGovernanceReconcilePlugin(makeDeps() as never);
    expect(plugin.sourceType).toBe('dual_governance_reconcile');
    expect([...plugin.supportedChainIds]).toEqual(['0x1']);
    expect([...plugin.capabilities]).toEqual([]);
  });

  it('parses config via the shared DG address schema', () => {
    const plugin = createLidoDualGovernanceReconcilePlugin(makeDeps() as never);
    expect(plugin.parseConfig({ dual_governance_address: DG, timelock_address: TL })).toEqual({
      dual_governance_address: DG,
      timelock_address: TL,
    });
    expect(() => plugin.parseConfig({ dual_governance_address: 'nope' })).toThrow();
  });

  it('does nothing when the head is below headLag', async () => {
    const deps = makeDeps();
    const spec = createLidoDualGovernanceReconcilePlugin(deps as never).buildIngestSpec(
      {} as never,
      {} as never,
    );
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: {},
      chainCfg: makeChainCfg() as never,
      headBlock: 11n,
      client: FAKE_CLIENT as never,
    });
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(deps.reconcile.findStaleForReconciliation).not.toHaveBeenCalled();
  });

  it('drives onConfirmedHeads with the confirmed threshold + recheck-gap blocks', async () => {
    const deps = makeDeps();
    const spec = createLidoDualGovernanceReconcilePlugin(deps as never).buildIngestSpec(
      {} as never,
      {} as never,
    );
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: {},
      chainCfg: makeChainCfg() as never,
      headBlock: 1000n,
      client: FAKE_CLIENT as never,
    });
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(deps.reconcile.findStaleForReconciliation).toHaveBeenCalledWith(
      ['dual_governance'],
      [
        expect.objectContaining({
          chainId: '0x1',
          confirmedThresholdBlock: '988',
          recheckGapBlocks: 600,
        }),
      ],
      10,
    );
  });

  it('honors LIDO_DG_RECONCILE_RECHECK_GAP_SECONDS', async () => {
    process.env['LIDO_DG_RECONCILE_RECHECK_GAP_SECONDS'] = '3600';
    const deps = makeDeps();
    const spec = createLidoDualGovernanceReconcilePlugin(deps as never).buildIngestSpec(
      {} as never,
      {} as never,
    );
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: {},
      chainCfg: makeChainCfg() as never,
      headBlock: 1000n,
      client: FAKE_CLIENT as never,
    });
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(deps.reconcile.findStaleForReconciliation).toHaveBeenCalledWith(
      ['dual_governance'],
      [expect.objectContaining({ recheckGapBlocks: 300 })],
      10,
    );
  });

  it('omits buildBackfillRuntime — not backfillable, signalled via capabilities', () => {
    const plugin = createLidoDualGovernanceReconcilePlugin(makeDeps() as never);
    expect(plugin.buildBackfillRuntime).toBeUndefined();
    expect([...plugin.capabilities]).not.toContain('backfillable');
  });
});
