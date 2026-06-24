import { afterEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import { createLidoAragonVotingReconcilePlugin } from './aragon-reconcile-plugin';

const NOOP_METRICS = {
  recordBacklog: () => undefined,
  recordBatchSaturated: () => undefined,
  recordOutcome: () => undefined,
  recordRpcFailEscalated: () => undefined,
  recordTickDurationSeconds: () => undefined,
};

const FAKE_CLIENT = { send: vi.fn() };

function makeChainCfg(overrides: Record<string, unknown> = {}) {
  return { chainId: '0x1', headLag: 12, blocksPerMinute: 5, ...overrides };
}

function makeDeps() {
  return {
    aragonProposals: { findStaleForReconciliation: vi.fn().mockResolvedValue([]) },
    proposals: {} as never,
    metrics: NOOP_METRICS,
    logger: silentLogger,
  };
}

afterEach(() => {
  delete process.env['LIDO_STATE_RECONCILE_RECHECK_GAP_SECONDS'];
});

describe('createLidoAragonVotingReconcilePlugin', () => {
  it('declares the aragon_voting_reconcile ingester contract', () => {
    const plugin = createLidoAragonVotingReconcilePlugin(makeDeps() as never);
    expect(plugin.sourceType).toBe('aragon_voting_reconcile');
    expect([...plugin.supportedChainIds]).toEqual(['0x1']);
    expect([...plugin.capabilities]).toEqual([]);
  });

  it('parses config via the shared voting_address schema', () => {
    const plugin = createLidoAragonVotingReconcilePlugin(makeDeps() as never);
    expect(plugin.parseConfig({ voting_address: '0x' + '2e'.repeat(20) })).toEqual({
      voting_address: '0x' + '2e'.repeat(20),
    });
    expect(() => plugin.parseConfig({ voting_address: 'nope' })).toThrow();
  });

  it('does nothing when the head is below headLag', async () => {
    const deps = makeDeps();
    const spec = createLidoAragonVotingReconcilePlugin(deps as never).buildIngestSpec(
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
    expect(deps.aragonProposals.findStaleForReconciliation).not.toHaveBeenCalled();
  });

  it('drives onConfirmedHeads with confirmed threshold + recheck gap blocks', async () => {
    const deps = makeDeps();
    const spec = createLidoAragonVotingReconcilePlugin(deps as never).buildIngestSpec(
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
    expect(deps.aragonProposals.findStaleForReconciliation).toHaveBeenCalledWith(
      ['aragon_voting'],
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

  it('honors LIDO_STATE_RECONCILE_RECHECK_GAP_SECONDS', async () => {
    process.env['LIDO_STATE_RECONCILE_RECHECK_GAP_SECONDS'] = '3600';
    const deps = makeDeps();
    const spec = createLidoAragonVotingReconcilePlugin(deps as never).buildIngestSpec(
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
    expect(deps.aragonProposals.findStaleForReconciliation).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ recheckGapBlocks: 300 })],
      50,
    );
  });

  it('refuses a backfill runtime', () => {
    expect(() =>
      createLidoAragonVotingReconcilePlugin(makeDeps() as never).buildBackfillRuntime(
        {} as never,
        {} as never,
      ),
    ).toThrow(/does not support backfill/);
  });
});
