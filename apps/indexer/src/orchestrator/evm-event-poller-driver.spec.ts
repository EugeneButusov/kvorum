import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventPoller } from '@libs/chain';
import type { IngestSpec, SourceContext } from '@sources/core';
import type { ChainContextRegistry } from './chain-context-registry';
import { EvmEventPollerDriver } from './evm-event-poller-driver';

vi.mock('@libs/chain', () => ({
  EventPoller: vi.fn(),
  chainMetrics: {
    pendingEventCount: { record: vi.fn() },
    indexerActiveSources: { record: vi.fn() },
    logPollWindowBlocks: { record: vi.fn() },
    logPollLag: { record: vi.fn() },
    logsFetched: { add: vi.fn() },
    logsWithRemovedFlag: { add: vi.fn() },
  },
}));

const CHAIN_CFG = {
  chainId: 1,
  name: 'ethereum',
  reorgHorizon: 12,
  lagThresholdBlocks: 5,
  overallTimeoutMs: 12_000,
  providers: [],
};

const CHAIN_CFG_137 = { ...CHAIN_CFG, chainId: 137, name: 'polygon' };

const CTX: SourceContext = {
  daoSourceId: 'src-1',
  sourceType: 'compound_governor',
  chainId: 1,
  sourceLabel: 'compound_governor',
};

const LISTENER = vi.fn();
const SPEC: Extract<IngestSpec, { kind: 'evm-event-poller' }> = {
  kind: 'evm-event-poller',
  filter: { address: '0xabc', topics: [] },
  listener: LISTENER,
};

function makeClient() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRegistryContext(client = makeClient()) {
  return {
    client,
    headTracker: {},
    reorgDetector: {},
    chainCfg: CHAIN_CFG,
  };
}

function makeRegistry(ctx = makeRegistryContext()): ChainContextRegistry {
  return {
    acquire: vi.fn().mockResolvedValue(ctx),
    release: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChainContextRegistry;
}

function setupMockPoller() {
  const instance = {
    onEvents: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(EventPoller).mockImplementation(function () {
    return instance;
  } as never);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EvmEventPollerDriver', () => {
  it('#1 — start() acquires context from registry, starts poller, wires listener', async () => {
    const registry = makeRegistry();
    const poller = setupMockPoller();

    const driver = new EvmEventPollerDriver(registry);
    await driver.start(SPEC, CTX, CHAIN_CFG);

    expect(registry.acquire).toHaveBeenCalledWith(CHAIN_CFG);
    expect(poller.start).toHaveBeenCalledTimes(1);
    expect(poller.onEvents).toHaveBeenCalledWith(LISTENER);
  });

  it('#2 — two sources on same chain: registry.acquire called twice (registry handles refcount)', async () => {
    const registry = makeRegistry();
    vi.mocked(EventPoller).mockImplementation(function () {
      return {
        onEvents: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    } as never);

    const driver = new EvmEventPollerDriver(registry);
    const ctx2 = { ...CTX, daoSourceId: 'src-2' };
    await driver.start(SPEC, CTX, CHAIN_CFG);
    await driver.start(SPEC, ctx2, CHAIN_CFG);

    expect(registry.acquire).toHaveBeenCalledTimes(2);
    expect(EventPoller).toHaveBeenCalledTimes(2);
  });

  it('#3 — two sources on different chains: acquire called per chain', async () => {
    const ctxA = makeRegistryContext();
    const ctxB = makeRegistryContext();
    const registry = {
      acquire: vi.fn().mockResolvedValueOnce(ctxA).mockResolvedValueOnce(ctxB),
      release: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChainContextRegistry;

    vi.mocked(EventPoller).mockImplementation(function () {
      return {
        onEvents: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    } as never);

    const driver = new EvmEventPollerDriver(registry);
    const ctx2 = { ...CTX, chainId: 137, daoSourceId: 'src-2' };
    await driver.start(SPEC, CTX, CHAIN_CFG);
    await driver.start(SPEC, ctx2, CHAIN_CFG_137);

    expect(registry.acquire).toHaveBeenCalledTimes(2);
    expect(registry.acquire).toHaveBeenCalledWith(CHAIN_CFG);
    expect(registry.acquire).toHaveBeenCalledWith(CHAIN_CFG_137);
  });

  it('#4 — stop() stops poller and calls registry.release', async () => {
    const registry = makeRegistry();
    const poller = setupMockPoller();

    const driver = new EvmEventPollerDriver(registry);
    const handle = await driver.start(SPEC, CTX, CHAIN_CFG);
    await handle.stop();

    expect(poller.stop).toHaveBeenCalledTimes(1);
    expect(registry.release).toHaveBeenCalledWith(CHAIN_CFG.chainId);
  });

  it('#5 — EventPoller constructed with rpcClient from registry context', async () => {
    const client = makeClient();
    const ctx = makeRegistryContext(client);
    const registry = makeRegistry(ctx);
    setupMockPoller();

    const driver = new EvmEventPollerDriver(registry);
    await driver.start(SPEC, CTX, CHAIN_CFG);

    const pollerOpts = vi.mocked(EventPoller).mock.calls[0]?.[0] as { rpcClient: typeof client };
    expect(pollerOpts.rpcClient).toBe(client);
  });

  it('#6 — registry.acquire() rejects: error propagates; release not called', async () => {
    const registry = {
      acquire: vi.fn().mockRejectedValue(new Error('rpc fail')),
      release: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChainContextRegistry;
    setupMockPoller();

    const driver = new EvmEventPollerDriver(registry);
    await expect(driver.start(SPEC, CTX, CHAIN_CFG)).rejects.toThrow('rpc fail');
    expect(registry.release).not.toHaveBeenCalled();
  });
});
