import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAaveGovernanceV3ReconcilePlugin } from './aave-governance-reconcile-plugin';

function makeDeps() {
  return {
    proposals: {
      findStaleForReconciliation: vi.fn().mockResolvedValue([]),
      markReconcileChecked: vi.fn(),
      reconcileState: vi.fn(),
    },
    metrics: {
      recordBacklog: vi.fn(),
      recordBatchSaturated: vi.fn(),
      recordOutcome: vi.fn(),
      recordRpcFailEscalated: vi.fn(),
      recordTickDurationSeconds: vi.fn(),
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function makeChainCfg(overrides: Partial<{ headLag: number; blocksPerMinute: number }> = {}) {
  return {
    chainId: '0x1',
    name: 'ethereum',
    headLag: overrides.headLag ?? 12,
    blocksPerMinute: overrides.blocksPerMinute,
    providers: [],
  };
}

const FAKE_HEAD = {
  chainId: '0x1',
  blockNumber: 0n,
  blockHash: '0x',
  parentHash: '0x',
  timestamp: 0n,
  observedAt: new Date(),
};
const FAKE_CLIENT = { send: vi.fn() };

describe('createAaveGovernanceV3ReconcilePlugin', () => {
  beforeEach(() => {
    delete process.env['AAVE_STATE_RECONCILE_RECHECK_GAP_SECONDS'];
  });

  afterEach(() => {
    delete process.env['AAVE_STATE_RECONCILE_RECHECK_GAP_SECONDS'];
  });

  it('exposes the reconcile source type and mainnet support', () => {
    const plugin = createAaveGovernanceV3ReconcilePlugin(makeDeps() as never);
    expect(plugin.sourceType).toBe('aave_governance_v3_reconcile');
    expect(plugin.supportedChainIds).toEqual(['0x1']);
  });

  it('queries event-source proposals with confirmed threshold and gap blocks', async () => {
    const deps = makeDeps();
    const plugin = createAaveGovernanceV3ReconcilePlugin(deps as never);
    const spec = plugin.buildIngestSpec({} as never, {} as never);
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: FAKE_HEAD,
      chainCfg: makeChainCfg({ headLag: 12, blocksPerMinute: 5 }) as never,
      headBlock: 1000n,
      client: FAKE_CLIENT as never,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(deps.proposals.findStaleForReconciliation).toHaveBeenCalledWith(
      ['aave_governance_v3'],
      [
        expect.objectContaining({
          chainId: '0x1',
          confirmedThresholdBlock: '988',
          recheckGapBlocks: 600,
        }),
      ],
      50,
    );
  });

  it('respects AAVE_STATE_RECONCILE_RECHECK_GAP_SECONDS when computing gap blocks', async () => {
    process.env['AAVE_STATE_RECONCILE_RECHECK_GAP_SECONDS'] = '3600';
    const deps = makeDeps();
    const plugin = createAaveGovernanceV3ReconcilePlugin(deps as never);
    const spec = plugin.buildIngestSpec({} as never, {} as never);
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: FAKE_HEAD,
      chainCfg: makeChainCfg({ blocksPerMinute: 5 }) as never,
      headBlock: 1000n,
      client: FAKE_CLIENT as never,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(deps.proposals.findStaleForReconciliation).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ recheckGapBlocks: 300 })],
      50,
    );
  });
});
