import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventPoller } from '@libs/chain';
import type { ChainContextRegistry } from '@libs/chain';
import type { DaoSourceRepository } from '@libs/db';
import type { IngestSpec, SourceContext } from '@sources/core';
import { EvmEventPollerDriver } from './evm-event-poller-driver';

vi.mock('@libs/chain', () => ({
  ChainContextRegistry: vi.fn(),
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
  chainId: '0x1',
  name: 'ethereum',
  reorgHorizon: 12,
  lagThresholdBlocks: 5,
  overallTimeoutMs: 12_000,
  providers: [],
};

const CHAIN_CFG_137 = { ...CHAIN_CFG, chainId: '0x89', name: 'polygon' };

const CTX: SourceContext = {
  daoSourceId: 'src-1',
  sourceType: 'compound_governor_bravo',
  chainId: '0x1',
  sourceLabel: 'compound_governor_bravo',
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

function makeRegistry(ctx = makeRegistryContext()): { registry: ChainContextRegistry } {
  const registry = {
    getOrCreate: vi.fn().mockResolvedValue(ctx),
  } as unknown as ChainContextRegistry;
  return { registry };
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

function makeDaoSourceRepo(): DaoSourceRepository {
  return {
    updateLiveHead: vi.fn().mockResolvedValue(undefined),
  } as unknown as DaoSourceRepository;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EvmEventPollerDriver', () => {
  it('#1 — start() gets context from registry, starts poller, wires listener', async () => {
    const { registry } = makeRegistry();
    const daoSourceRepo = makeDaoSourceRepo();
    const poller = setupMockPoller();

    const driver = new EvmEventPollerDriver(registry, daoSourceRepo);
    await driver.start(SPEC, CTX, CHAIN_CFG);

    expect(registry.getOrCreate).toHaveBeenCalledWith(CHAIN_CFG);
    expect(poller.start).toHaveBeenCalledTimes(1);
    expect(poller.onEvents).toHaveBeenCalledWith(LISTENER);
  });

  it('#2 — two sources on same chain: registry.getOrCreate called twice (registry handles caching)', async () => {
    const { registry } = makeRegistry();
    const daoSourceRepo = makeDaoSourceRepo();
    vi.mocked(EventPoller).mockImplementation(function () {
      return {
        onEvents: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    } as never);

    const driver = new EvmEventPollerDriver(registry, daoSourceRepo);
    const ctx2 = { ...CTX, daoSourceId: 'src-2' };
    await driver.start(SPEC, CTX, CHAIN_CFG);
    await driver.start(SPEC, ctx2, CHAIN_CFG);

    expect(registry.getOrCreate).toHaveBeenCalledTimes(2);
    expect(EventPoller).toHaveBeenCalledTimes(2);
  });

  it('#3 — two sources on different chains: getOrCreate called per chain', async () => {
    const ctxA = makeRegistryContext();
    const ctxB = makeRegistryContext();
    const daoSourceRepo = makeDaoSourceRepo();
    const registry = {
      getOrCreate: vi.fn().mockResolvedValueOnce(ctxA).mockResolvedValueOnce(ctxB),
    } as unknown as ChainContextRegistry;

    vi.mocked(EventPoller).mockImplementation(function () {
      return {
        onEvents: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    } as never);

    const driver = new EvmEventPollerDriver(registry, daoSourceRepo);
    const ctx2 = { ...CTX, chainId: '0x89', daoSourceId: 'src-2' };
    await driver.start(SPEC, CTX, CHAIN_CFG);
    await driver.start(SPEC, ctx2, CHAIN_CFG_137);

    expect(registry.getOrCreate).toHaveBeenCalledTimes(2);
    expect(registry.getOrCreate).toHaveBeenCalledWith(CHAIN_CFG);
    expect(registry.getOrCreate).toHaveBeenCalledWith(CHAIN_CFG_137);
  });

  it('#4 — stop() stops poller only', async () => {
    const { registry } = makeRegistry();
    const daoSourceRepo = makeDaoSourceRepo();
    const poller = setupMockPoller();

    const driver = new EvmEventPollerDriver(registry, daoSourceRepo);
    const handle = await driver.start(SPEC, CTX, CHAIN_CFG);
    await handle.stop();

    expect(poller.stop).toHaveBeenCalledTimes(1);
  });

  it('#5 — EventPoller constructed with rpcClient from registry context', async () => {
    const client = makeClient();
    const { registry } = makeRegistry(makeRegistryContext(client));
    const daoSourceRepo = makeDaoSourceRepo();
    setupMockPoller();

    const driver = new EvmEventPollerDriver(registry, daoSourceRepo);
    await driver.start(SPEC, CTX, CHAIN_CFG);

    const pollerOpts = vi.mocked(EventPoller).mock.calls[0]?.[0] as { rpcClient: typeof client };
    expect(pollerOpts.rpcClient).toBe(client);
  });

  it('#6 — registry.getOrCreate() rejects: error propagates', async () => {
    const registry = {
      getOrCreate: vi.fn().mockRejectedValue(new Error('rpc fail')),
    } as unknown as ChainContextRegistry;
    const daoSourceRepo = makeDaoSourceRepo();
    setupMockPoller();

    const driver = new EvmEventPollerDriver(registry, daoSourceRepo);
    await expect(driver.start(SPEC, CTX, CHAIN_CFG)).rejects.toThrow('rpc fail');
  });

  it('#7 — wires onBlockComplete to dao_source live head updates', async () => {
    const { registry } = makeRegistry();
    const daoSourceRepo = makeDaoSourceRepo();
    setupMockPoller();

    const driver = new EvmEventPollerDriver(registry, daoSourceRepo);
    await driver.start(SPEC, CTX, CHAIN_CFG);

    const pollerOpts = vi.mocked(EventPoller).mock.calls[0]?.[0] as {
      onBlockComplete: (head: bigint) => Promise<void>;
    };
    await pollerOpts.onBlockComplete(123n);

    expect(daoSourceRepo.updateLiveHead).toHaveBeenCalledWith('src-1', 123n);
  });

  it('#8 — passes bootstrapFromBlock = live_head_block + 1 when available', async () => {
    const { registry } = makeRegistry();
    const daoSourceRepo = {
      updateLiveHead: vi.fn().mockResolvedValue(undefined),
      findByIdWithChain: vi.fn().mockResolvedValue({
        id: 'src-1',
        live_head_block: '200',
      }),
    } as unknown as DaoSourceRepository;
    setupMockPoller();

    const driver = new EvmEventPollerDriver(registry, daoSourceRepo);
    await driver.start(SPEC, CTX, CHAIN_CFG);

    const pollerOpts = vi.mocked(EventPoller).mock.calls[0]?.[0] as { bootstrapFromBlock?: bigint };
    expect(pollerOpts.bootstrapFromBlock).toBe(201n);
  });
});
