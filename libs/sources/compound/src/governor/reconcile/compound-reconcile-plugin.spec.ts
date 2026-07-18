import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCompoundGovernorAlphaReconcilePlugin,
  createCompoundGovernorBravoReconcilePlugin,
  createCompoundGovernorOzReconcilePlugin,
} from './compound-reconcile-plugin';
import { SUPPORTED_CHAIN_IDS } from '../plugin/plugin';

function makeDeps() {
  const proposals = {
    findStaleForReconciliation: vi.fn().mockResolvedValue([]),
    markReconcileChecked: vi.fn(),
    reconcileState: vi.fn(),
    findReconcileBounds: vi.fn().mockResolvedValue([]),
  };
  const metrics = {
    recordBacklog: vi.fn(),
    recordBatchSaturated: vi.fn(),
    recordOutcome: vi.fn(),
    recordRpcFailEscalated: vi.fn(),
    recordTickDurationSeconds: vi.fn(),
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { proposals, metrics, logger };
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

describe('createCompoundGovernorBravoReconcilePlugin', () => {
  it('exposes correct sourceType', () => {
    const plugin = createCompoundGovernorBravoReconcilePlugin(makeDeps() as never);
    expect(plugin.sourceType).toBe('compound_governor_bravo_reconcile');
  });

  it('exposes SUPPORTED_CHAIN_IDS', () => {
    const plugin = createCompoundGovernorBravoReconcilePlugin(makeDeps() as never);
    expect(plugin.supportedChainIds).toEqual(SUPPORTED_CHAIN_IDS);
  });

  it('parseConfig accepts a valid governor address config', () => {
    const plugin = createCompoundGovernorBravoReconcilePlugin(makeDeps() as never);
    expect(() =>
      plugin.parseConfig({ governor_address: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529' }),
    ).not.toThrow();
  });

  it('buildIngestSpec returns evm-block-head-poller kind', () => {
    const plugin = createCompoundGovernorBravoReconcilePlugin(makeDeps() as never);
    const spec = plugin.buildIngestSpec({} as never, {} as never);
    expect(spec.kind).toBe('evm-block-head-poller');
  });
});

describe('createCompoundGovernorOzReconcilePlugin', () => {
  it('exposes correct sourceType', () => {
    const plugin = createCompoundGovernorOzReconcilePlugin(makeDeps() as never);
    expect(plugin.sourceType).toBe('compound_governor_oz_reconcile');
  });
});

describe('createCompoundGovernorAlphaReconcilePlugin', () => {
  it('exposes correct sourceType', () => {
    const plugin = createCompoundGovernorAlphaReconcilePlugin(makeDeps() as never);
    expect(plugin.sourceType).toBe('compound_governor_alpha_reconcile');
  });

  it('parseConfig accepts the alpha governor address config', () => {
    const plugin = createCompoundGovernorAlphaReconcilePlugin(makeDeps() as never);
    expect(() =>
      plugin.parseConfig({ governor_address: '0xc0dA01a04C3f3E0be433606045bB7017A7323E38' }),
    ).not.toThrow();
  });
});

describe('reconcile plugin listener', () => {
  beforeEach(() => {
    delete process.env['COMPOUND_STATE_RECONCILE_RECHECK_GAP_SECONDS'];
  });

  afterEach(() => {
    delete process.env['COMPOUND_STATE_RECONCILE_RECHECK_GAP_SECONDS'];
  });

  it('does nothing when headBlock < headLag', async () => {
    const deps = makeDeps();
    const plugin = createCompoundGovernorBravoReconcilePlugin(deps as never);
    const spec = plugin.buildIngestSpec({} as never, {} as never);
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: FAKE_HEAD,
      chainCfg: makeChainCfg({ headLag: 12 }) as never,
      headBlock: 5n,
      client: FAKE_CLIENT as never,
    });

    await new Promise<void>((r) => setTimeout(r, 10));
    expect(deps.proposals.findStaleForReconciliation).not.toHaveBeenCalled();
  });

  it('calls findStaleForReconciliation with confirmedThresholdBlock = headBlock - headLag', async () => {
    const deps = makeDeps();
    const plugin = createCompoundGovernorBravoReconcilePlugin(deps as never);
    const spec = plugin.buildIngestSpec({} as never, {} as never);
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: FAKE_HEAD,
      chainCfg: makeChainCfg({ headLag: 12 }) as never,
      headBlock: 1000n,
      client: FAKE_CLIENT as never,
    });

    await new Promise<void>((r) => setTimeout(r, 10));
    expect(deps.proposals.findStaleForReconciliation).toHaveBeenCalledWith(
      ['compound_governor_bravo'],
      expect.arrayContaining([
        expect.objectContaining({ confirmedThresholdBlock: '988' }), // 1000 - 12
      ]),
      expect.any(Number),
    );
  });

  it('passes chainId from chainCfg to findStaleForReconciliation bound', async () => {
    const deps = makeDeps();
    const plugin = createCompoundGovernorBravoReconcilePlugin(deps as never);
    const spec = plugin.buildIngestSpec({} as never, {} as never);
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: FAKE_HEAD,
      chainCfg: makeChainCfg() as never,
      headBlock: 100n,
      client: FAKE_CLIENT as never,
    });

    await new Promise<void>((r) => setTimeout(r, 10));
    expect(deps.proposals.findStaleForReconciliation).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ chainId: '0x1' })]),
      expect.any(Number),
    );
  });

  it('computes recheckGapBlocks from default env (7200s, 5 bpm → 600 blocks)', async () => {
    const deps = makeDeps();
    const plugin = createCompoundGovernorBravoReconcilePlugin(deps as never);
    const spec = plugin.buildIngestSpec({} as never, {} as never);
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: FAKE_HEAD,
      chainCfg: makeChainCfg({ blocksPerMinute: 5 }) as never,
      headBlock: 1000n,
      client: FAKE_CLIENT as never,
    });

    await new Promise<void>((r) => setTimeout(r, 10));
    // ceil((7200 / 60) * 5) = ceil(600) = 600
    expect(deps.proposals.findStaleForReconciliation).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ recheckGapBlocks: 600 })]),
      expect.any(Number),
    );
  });

  it('computes recheckGapBlocks from COMPOUND_STATE_RECONCILE_RECHECK_GAP_SECONDS env var', async () => {
    process.env['COMPOUND_STATE_RECONCILE_RECHECK_GAP_SECONDS'] = '3600';
    const deps = makeDeps();
    const plugin = createCompoundGovernorBravoReconcilePlugin(deps as never);
    const spec = plugin.buildIngestSpec({} as never, {} as never);
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: FAKE_HEAD,
      chainCfg: makeChainCfg({ blocksPerMinute: 5 }) as never,
      headBlock: 1000n,
      client: FAKE_CLIENT as never,
    });

    await new Promise<void>((r) => setTimeout(r, 10));
    // ceil((3600 / 60) * 5) = ceil(300) = 300
    expect(deps.proposals.findStaleForReconciliation).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ recheckGapBlocks: 300 })]),
      expect.any(Number),
    );
  });

  it('uses chainCfg.blocksPerMinute when set', async () => {
    const deps = makeDeps();
    const plugin = createCompoundGovernorBravoReconcilePlugin(deps as never);
    const spec = plugin.buildIngestSpec({} as never, {} as never);
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: FAKE_HEAD,
      chainCfg: makeChainCfg({ blocksPerMinute: 10 }) as never,
      headBlock: 1000n,
      client: FAKE_CLIENT as never,
    });

    await new Promise<void>((r) => setTimeout(r, 10));
    // ceil((7200 / 60) * 10) = ceil(1200) = 1200
    expect(deps.proposals.findStaleForReconciliation).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ recheckGapBlocks: 1200 })]),
      expect.any(Number),
    );
  });

  it('alpha plugin queries compound_governor_alpha proposals', async () => {
    const deps = makeDeps();
    const plugin = createCompoundGovernorAlphaReconcilePlugin(deps as never);
    const spec = plugin.buildIngestSpec({} as never, {} as never);
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: FAKE_HEAD,
      chainCfg: makeChainCfg() as never,
      headBlock: 100n,
      client: FAKE_CLIENT as never,
    });

    await new Promise<void>((r) => setTimeout(r, 10));
    expect(deps.proposals.findStaleForReconciliation).toHaveBeenCalledWith(
      ['compound_governor_alpha'],
      expect.anything(),
      expect.any(Number),
    );
  });

  it('oz plugin queries compound_governor_oz proposals', async () => {
    const deps = makeDeps();
    const plugin = createCompoundGovernorOzReconcilePlugin(deps as never);
    const spec = plugin.buildIngestSpec({} as never, {} as never);
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: FAKE_HEAD,
      chainCfg: makeChainCfg() as never,
      headBlock: 100n,
      client: FAKE_CLIENT as never,
    });

    await new Promise<void>((r) => setTimeout(r, 10));
    expect(deps.proposals.findStaleForReconciliation).toHaveBeenCalledWith(
      ['compound_governor_oz'],
      expect.anything(),
      expect.any(Number),
    );
  });
});
