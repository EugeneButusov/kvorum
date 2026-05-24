import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client/failover-rpc-client.js', () => ({ FailoverRpcClient: vi.fn() }));
vi.mock('./poller/head-tracker.js', () => ({ HeadTracker: vi.fn() }));
vi.mock('./proxy/proxy-resolver.js', () => ({ ProxyResolver: vi.fn() }));

import { ChainContextRegistry } from './chain-context-registry.js';
import { FailoverRpcClient } from './client/failover-rpc-client.js';
import { HeadTracker } from './poller/head-tracker.js';

const CHAIN_CFG = { chainId: '0x1', name: 'ethereum', headLag: 12, providers: [] };
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

function setupMocks(client = makeClient(), tracker = makeTracker()) {
  vi.mocked(FailoverRpcClient).mockImplementation(function () {
    return client;
  } as never);
  vi.mocked(HeadTracker).mockImplementation(function () {
    return tracker;
  } as never);
  return { client, tracker };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChainContextRegistry', () => {
  it('#1 — first getOrCreate: constructs client + headTracker and starts tracker', async () => {
    const { client, tracker } = setupMocks();

    const registry = new ChainContextRegistry();
    const ctx = await registry.getOrCreate(CHAIN_CFG);

    expect(FailoverRpcClient).toHaveBeenCalledWith(CHAIN_CFG);
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(HeadTracker).toHaveBeenCalledTimes(1);
    expect(tracker.start).toHaveBeenCalledTimes(1);
    expect(ctx.client).toBe(client);
    expect(ctx.headTracker).toBe(tracker);
    expect(ctx.chainCfg).toBe(CHAIN_CFG);
  });

  it('#2 — second getOrCreate for same chainId: returns cached context, no new client/tracker', async () => {
    const { client, tracker } = setupMocks();

    const registry = new ChainContextRegistry();
    const ctx1 = await registry.getOrCreate(CHAIN_CFG);
    const ctx2 = await registry.getOrCreate(CHAIN_CFG);

    expect(ctx1.client).toBe(ctx2.client);
    expect(ctx1.headTracker).toBe(ctx2.headTracker);
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(HeadTracker).toHaveBeenCalledTimes(1);
    expect(tracker.start).toHaveBeenCalledTimes(1);
  });

  it('#3 — two different chainIds: two distinct contexts', async () => {
    const clientA = makeClient();
    const clientB = makeClient();
    const trackerA = makeTracker();
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
    const registry = new ChainContextRegistry();
    const ctxA = await registry.getOrCreate(CHAIN_CFG);
    const ctxB = await registry.getOrCreate(CHAIN_CFG_137);

    expect(ctxA.client).not.toBe(ctxB.client);
    expect(ctxA.client).toBe(clientA);
    expect(ctxB.client).toBe(clientB);
    expect(clientA.start).toHaveBeenCalledTimes(1);
    expect(clientB.start).toHaveBeenCalledTimes(1);
  });

  it('#4 — drainAll: stops every tracker + client; entries cleared; safe when one tracker rejects', async () => {
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
    const registry = new ChainContextRegistry();
    await registry.getOrCreate(CHAIN_CFG);
    await registry.getOrCreate(CHAIN_CFG_137);

    await expect(registry.drainAll()).resolves.toBeUndefined();

    expect(trackerA.stop).toHaveBeenCalledTimes(1);
    expect(trackerB.stop).toHaveBeenCalledTimes(1);
    expect(clientA.stop).toHaveBeenCalledTimes(1);
    expect(clientB.stop).toHaveBeenCalledTimes(1);
    expect(registry.allActive()).toHaveLength(0);
  });

  it('#5 — getOrCreate failure: client.start() rejects → no entry left; subsequent getOrCreate retries from scratch', async () => {
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
    const registry = new ChainContextRegistry();

    await expect(registry.getOrCreate(CHAIN_CFG)).rejects.toThrow('rpc fail');
    expect(registry.peek(CHAIN_CFG.chainId)).toBeUndefined();

    const ctx = await registry.getOrCreate(CHAIN_CFG);
    expect(ctx.client).toBe(goodClient);
  });
});
