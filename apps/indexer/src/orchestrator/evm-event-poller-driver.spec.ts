import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventPoller, FailoverRpcClient } from '@libs/chain';
import type { IngestSpec, SourceContext } from '@sources/core';
import { EvmEventPollerDriver } from './evm-event-poller-driver';

vi.mock('@libs/chain', () => ({
  EventPoller: vi.fn(),
  FailoverRpcClient: vi.fn(),
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

function setupMockClient() {
  const instance = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(FailoverRpcClient).mockImplementation(function () {
    return instance;
  } as never);
  return instance;
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
  it('#1 — start() starts client then poller and wires listener', async () => {
    const client = setupMockClient();
    const poller = setupMockPoller();

    const driver = new EvmEventPollerDriver();
    await driver.start(SPEC, CTX, CHAIN_CFG);

    expect(client.start).toHaveBeenCalledTimes(1);
    expect(poller.start).toHaveBeenCalledTimes(1);
    expect(poller.onEvents).toHaveBeenCalledWith(LISTENER);
  });

  it('#2 — two sources on same chain share one client', async () => {
    const client = setupMockClient();
    vi.mocked(EventPoller).mockImplementation(function () {
      return {
        onEvents: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    } as never);

    const driver = new EvmEventPollerDriver();
    const ctx2 = { ...CTX, daoSourceId: 'src-2' };
    await driver.start(SPEC, CTX, CHAIN_CFG);
    await driver.start(SPEC, ctx2, CHAIN_CFG);

    expect(client.start).toHaveBeenCalledTimes(1);
    expect(EventPoller).toHaveBeenCalledTimes(2);
  });

  it('#3 — two sources on different chains get separate clients', async () => {
    const clientA = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const clientB = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(FailoverRpcClient)
      .mockImplementationOnce(function () {
        return clientA;
      } as never)
      .mockImplementationOnce(function () {
        return clientB;
      } as never);
    vi.mocked(EventPoller).mockImplementation(function () {
      return {
        onEvents: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    } as never);

    const driver = new EvmEventPollerDriver();
    const ctx2 = { ...CTX, chainId: 137, daoSourceId: 'src-2' };
    await driver.start(SPEC, CTX, CHAIN_CFG);
    await driver.start(SPEC, ctx2, CHAIN_CFG_137);

    expect(clientA.start).toHaveBeenCalledTimes(1);
    expect(clientB.start).toHaveBeenCalledTimes(1);
  });

  it('#4 — stop() stops poller and decrements client refcount; client stopped when last poller stops', async () => {
    const client = setupMockClient();
    const poller = setupMockPoller();

    const driver = new EvmEventPollerDriver();
    const handle = await driver.start(SPEC, CTX, CHAIN_CFG);

    await handle.stop();

    expect(poller.stop).toHaveBeenCalledTimes(1);
    expect(client.stop).toHaveBeenCalledTimes(1);
  });

  it('#5 — client NOT stopped until last poller handle stops', async () => {
    const client = setupMockClient();
    vi.mocked(EventPoller).mockImplementation(function () {
      return {
        onEvents: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    } as never);

    const driver = new EvmEventPollerDriver();
    const ctx2 = { ...CTX, daoSourceId: 'src-2' };
    const h1 = await driver.start(SPEC, CTX, CHAIN_CFG);
    const h2 = await driver.start(SPEC, ctx2, CHAIN_CFG);

    await h1.stop();
    expect(client.stop).not.toHaveBeenCalled();

    await h2.stop();
    expect(client.stop).toHaveBeenCalledTimes(1);
  });

  it('#6 — partial start failure: chain-B client.start() rejects; chain-A handle survives unaffected', async () => {
    const clientA = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const clientB = {
      start: vi.fn().mockRejectedValue(new Error('B failed')),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(FailoverRpcClient)
      .mockImplementationOnce(function () {
        return clientA;
      } as never)
      .mockImplementationOnce(function () {
        return clientB;
      } as never);
    vi.mocked(EventPoller).mockImplementation(function () {
      return {
        onEvents: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    } as never);

    const driver = new EvmEventPollerDriver();

    // chain 1 starts OK → clientA
    const handleA = await driver.start(SPEC, CTX, CHAIN_CFG);
    expect(clientA.start).toHaveBeenCalledTimes(1);

    // chain 137 fails → clientB.start() rejects
    const ctx2 = { ...CTX, chainId: 137, daoSourceId: 'src-2' };
    await expect(driver.start(SPEC, ctx2, CHAIN_CFG_137)).rejects.toThrow('B failed');

    // chain-A handle still alive
    expect(clientA.stop).not.toHaveBeenCalled();
    await handleA.stop();
    expect(clientA.stop).toHaveBeenCalledTimes(1);
  });
});
