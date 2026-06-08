import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAavePayloadsControllerReconcilePlugin } from './aave-payloads-controller-reconcile-plugin';

function makeDeps() {
  return {
    proposals: {
      findStaleForReconciliation: vi.fn().mockResolvedValue([]),
      markPayloadReconcileChecked: vi.fn(),
      expirePayload: vi.fn(),
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
    chainId: '0xa',
    name: 'optimism',
    headLag: overrides.headLag ?? 12,
    blocksPerMinute: overrides.blocksPerMinute,
    providers: [],
  };
}

const FAKE_HEAD = {
  chainId: '0xa',
  blockNumber: 0n,
  blockHash: '0x',
  parentHash: '0x',
  timestamp: 0n,
  observedAt: new Date(),
};
const FAKE_CLIENT = { send: vi.fn() };

describe('createAavePayloadsControllerReconcilePlugin', () => {
  beforeEach(() => {
    delete process.env['AAVE_STATE_RECONCILE_RECHECK_GAP_SECONDS'];
  });

  afterEach(() => {
    delete process.env['AAVE_STATE_RECONCILE_RECHECK_GAP_SECONDS'];
  });

  it('exposes the reconcile source type and payload-controller chain support', () => {
    const plugin = createAavePayloadsControllerReconcilePlugin(makeDeps() as never);
    expect(plugin.sourceType).toBe('aave_payloads_controller_reconcile');
    expect(plugin.supportedChainIds).toContain('0xa');
    expect(plugin.supportedChainIds).toContain('0x1');
  });

  it('parses ingest config with the payload-controller schema', () => {
    const plugin = createAavePayloadsControllerReconcilePlugin(makeDeps() as never);

    expect(
      plugin.parseConfig({
        payloads_controller_address: '0x0E1a3Af1f9cC76A62eD31eDedca291E63632e7c4',
      }),
    ).toMatchObject({
      payloads_controller_address: '0x0E1a3Af1f9cC76A62eD31eDedca291E63632e7c4',
    });
  });

  it('does nothing when the head is below headLag', async () => {
    const deps = makeDeps();
    const plugin = createAavePayloadsControllerReconcilePlugin(deps as never);
    const spec = plugin.buildIngestSpec({} as never, {} as never);
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: FAKE_HEAD,
      chainCfg: makeChainCfg({ headLag: 12 }) as never,
      headBlock: 11n,
      client: FAKE_CLIENT as never,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(deps.proposals.findStaleForReconciliation).not.toHaveBeenCalled();
  });

  it('queries payload rows with destination-chain confirmed threshold and gap blocks', async () => {
    const deps = makeDeps();
    const plugin = createAavePayloadsControllerReconcilePlugin(deps as never);
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
      ['aave_payloads_controller'],
      [
        expect.objectContaining({
          chainId: '0xa',
          confirmedThresholdBlock: '988',
          recheckGapBlocks: 600,
        }),
      ],
      50,
    );
  });

  it('throws when backfill runtime is requested', () => {
    const plugin = createAavePayloadsControllerReconcilePlugin(makeDeps() as never);

    expect(() => plugin.buildBackfillRuntime({} as never, {} as never)).toThrow(
      'source_type "aave_payloads_controller_reconcile" does not support backfill runtime',
    );
  });
});
