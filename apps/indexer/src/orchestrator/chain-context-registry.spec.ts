import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FailoverRpcClient, HeadTracker, ReorgDetector } from '@libs/chain';
import { ChainContextRegistry } from './chain-context-registry';

vi.mock('@libs/chain', () => ({
  FailoverRpcClient: vi.fn(),
  HeadTracker: vi.fn(),
  ReorgDetector: vi.fn(),
  chainMetrics: {
    pendingEventCount: { record: vi.fn() },
    indexerActiveSources: { record: vi.fn() },
  },
}));

const CHAIN_CFG = {
  chainId: '0x1',
  name: 'ethereum',
  reorgHorizon: 12,
  providers: [],
};

const CHAIN_CFG_137 = { ...CHAIN_CFG, chainId: '0x89', name: 'polygon' };

function makeClient() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function makeTracker() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onHead: vi.fn().mockReturnValue(() => {}),
    getLastHead: vi.fn().mockReturnValue(null),
  };
}

function makeDetector() {
  return {
    attach: vi.fn().mockReturnValue(() => {}),
    onReorg: vi.fn().mockReturnValue(() => {}),
  };
}

function setupMocks(client = makeClient(), tracker = makeTracker(), detector = makeDetector()) {
  vi.mocked(FailoverRpcClient).mockImplementation(function () {
    return client;
  } as never);
  vi.mocked(HeadTracker).mockImplementation(function () {
    return tracker;
  } as never);
  vi.mocked(ReorgDetector).mockImplementation(function () {
    return detector;
  } as never);
  return { client, tracker, detector };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChainContextRegistry', () => {
  it('#1 — first lease: constructs client, headTracker, reorgDetector; attaches detector; starts tracker', async () => {
    const { client, tracker, detector } = setupMocks();

    const registry = new ChainContextRegistry();
    const lease = await registry.lease(CHAIN_CFG);

    expect(FailoverRpcClient).toHaveBeenCalledWith(CHAIN_CFG);
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(HeadTracker).toHaveBeenCalledTimes(1);
    expect(ReorgDetector).toHaveBeenCalledTimes(1);
    expect(detector.attach).toHaveBeenCalledWith(tracker);
    expect(tracker.start).toHaveBeenCalledTimes(1);
    expect(lease.client).toBe(client);
    expect(lease.headTracker).toBe(tracker);
    expect(lease.reorgDetector).toBe(detector);
    expect(lease.chainCfg).toBe(CHAIN_CFG);
  });

  it('#2 — second lease for same chainId: shares underlying context, no new client/tracker', async () => {
    const { client, tracker } = setupMocks();

    const registry = new ChainContextRegistry();
    const lease1 = await registry.lease(CHAIN_CFG);
    const lease2 = await registry.lease(CHAIN_CFG);

    expect(lease1.client).toBe(lease2.client);
    expect(lease1.headTracker).toBe(lease2.headTracker);
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(HeadTracker).toHaveBeenCalledTimes(1);
    expect(tracker.start).toHaveBeenCalledTimes(1);
  });

  it('#3 — two different chainIds: two distinct leases with distinct contexts', async () => {
    const clientA = makeClient();
    const clientB = makeClient();
    const trackerA = makeTracker();
    const trackerB = makeTracker();
    const detectorA = makeDetector();
    const detectorB = makeDetector();

    vi.mocked(FailoverRpcClient)
      .mockImplementationOnce(function () {
        return clientA;
      } as never)
      .mockImplementationOnce(function () {
        return clientB;
      } as never);
    vi.mocked(HeadTracker)
      .mockImplementationOnce(function () {
        return trackerA;
      } as never)
      .mockImplementationOnce(function () {
        return trackerB;
      } as never);
    vi.mocked(ReorgDetector)
      .mockImplementationOnce(function () {
        return detectorA;
      } as never)
      .mockImplementationOnce(function () {
        return detectorB;
      } as never);

    const registry = new ChainContextRegistry();
    const leaseA = await registry.lease(CHAIN_CFG);
    const leaseB = await registry.lease(CHAIN_CFG_137);

    expect(leaseA.client).not.toBe(leaseB.client);
    expect(leaseA.client).toBe(clientA);
    expect(leaseB.client).toBe(clientB);
    expect(clientA.start).toHaveBeenCalledTimes(1);
    expect(clientB.start).toHaveBeenCalledTimes(1);
  });

  it('#4 — release with refcount > 1: decrements refcount, tracker + client NOT stopped', async () => {
    const { client, tracker } = setupMocks();

    const registry = new ChainContextRegistry();
    const lease1 = await registry.lease(CHAIN_CFG);
    await registry.lease(CHAIN_CFG);

    await lease1.release();

    expect(tracker.stop).not.toHaveBeenCalled();
    expect(client.stop).not.toHaveBeenCalled();
    expect(registry.peek(CHAIN_CFG.chainId)).toBeDefined();
  });

  it('#5 — last lease released: stops tracker then client; entry removed', async () => {
    const { client, tracker } = setupMocks();

    const registry = new ChainContextRegistry();
    const lease = await registry.lease(CHAIN_CFG);

    await lease.release();

    expect(tracker.stop).toHaveBeenCalledTimes(1);
    expect(client.stop).toHaveBeenCalledTimes(1);
    expect(registry.peek(CHAIN_CFG.chainId)).toBeUndefined();
  });

  it('#6 — double-release is idempotent: stops tracker + client only once', async () => {
    const { client, tracker } = setupMocks();

    const registry = new ChainContextRegistry();
    const lease = await registry.lease(CHAIN_CFG);

    await lease.release();
    await lease.release();

    expect(tracker.stop).toHaveBeenCalledTimes(1);
    expect(client.stop).toHaveBeenCalledTimes(1);
  });

  it('#7 — drainAll: stops every tracker + client; entries cleared; safe when one tracker rejects', async () => {
    const clientA = makeClient();
    const trackerA = {
      ...makeTracker(),
      stop: vi.fn().mockRejectedValue(new Error('tracker fail')),
    };
    const clientB = makeClient();
    const trackerB = makeTracker();

    vi.mocked(FailoverRpcClient)
      .mockImplementationOnce(function () {
        return clientA;
      } as never)
      .mockImplementationOnce(function () {
        return clientB;
      } as never);
    vi.mocked(HeadTracker)
      .mockImplementationOnce(function () {
        return trackerA;
      } as never)
      .mockImplementationOnce(function () {
        return trackerB;
      } as never);
    vi.mocked(ReorgDetector).mockImplementation(function () {
      return makeDetector();
    } as never);

    const registry = new ChainContextRegistry();
    await registry.lease(CHAIN_CFG);
    await registry.lease(CHAIN_CFG_137);

    await expect(registry.drainAll()).resolves.toBeUndefined();

    expect(trackerA.stop).toHaveBeenCalledTimes(1);
    expect(trackerB.stop).toHaveBeenCalledTimes(1);
    expect(clientA.stop).toHaveBeenCalledTimes(1);
    expect(clientB.stop).toHaveBeenCalledTimes(1);
    expect(registry.allActive()).toHaveLength(0);
  });

  it('#8 — lease failure: client.start() rejects → no entry left; subsequent lease retries from scratch', async () => {
    const failClient = { start: vi.fn().mockRejectedValue(new Error('rpc fail')), stop: vi.fn() };
    const goodClient = makeClient();
    const tracker = makeTracker();

    vi.mocked(FailoverRpcClient)
      .mockImplementationOnce(function () {
        return failClient;
      } as never)
      .mockImplementationOnce(function () {
        return goodClient;
      } as never);
    vi.mocked(HeadTracker).mockImplementation(function () {
      return tracker;
    } as never);
    vi.mocked(ReorgDetector).mockImplementation(function () {
      return makeDetector();
    } as never);

    const registry = new ChainContextRegistry();

    await expect(registry.lease(CHAIN_CFG)).rejects.toThrow('rpc fail');
    expect(registry.peek(CHAIN_CFG.chainId)).toBeUndefined();

    const lease = await registry.lease(CHAIN_CFG);
    expect(lease.client).toBe(goodClient);
  });

  it('#9 — whenReady() resolves after markReady()', async () => {
    const registry = new ChainContextRegistry();
    const promise = registry.whenReady();
    registry.markReady();
    await expect(promise).resolves.toBeUndefined();
    // Subsequent calls resolve immediately
    await expect(registry.whenReady()).resolves.toBeUndefined();
  });

  it('#10 — whenReady() rejects after markFailed(); markReady after markFailed is a no-op', async () => {
    const registry = new ChainContextRegistry();
    const err = new Error('boot failed');
    registry.markFailed(err);
    await expect(registry.whenReady()).rejects.toThrow('boot failed');
    // markReady after markFailed has no effect
    registry.markReady();
    await expect(registry.whenReady()).rejects.toThrow('boot failed');
  });
});
