import { describe, expect, it, vi } from 'vitest';
import { EvmBlockHeadPollerDriver } from './evm-block-head-poller-driver';

const CHAIN_CFG = {
  chainId: '0x1',
  name: 'ethereum',
  reorgHorizon: 12,
  providers: [],
};

function makeHeadTracker() {
  const unsub = vi.fn();
  return {
    onHead: vi.fn().mockReturnValue(unsub),
    _unsub: unsub,
  };
}

function makeRegistry(headTracker = makeHeadTracker()) {
  const chainCtx = { headTracker, client: {}, chainCfg: CHAIN_CFG };
  return {
    getOrCreate: vi.fn().mockResolvedValue(chainCtx),
    _chainCtx: chainCtx,
  };
}

const FAKE_CTX = {
  daoSourceId: 'src-1',
  sourceType: 'compound_governor_bravo_reconcile' as never,
  chainId: '0x1',
  sourceLabel: 'compound_governor_bravo_reconcile' as never,
};

describe('EvmBlockHeadPollerDriver', () => {
  it('has kind evm-block-head-poller', () => {
    const driver = new EvmBlockHeadPollerDriver({} as never);
    expect(driver.kind).toBe('evm-block-head-poller');
  });

  it('start() calls registry.getOrCreate with the supplied chainCfg', async () => {
    const registry = makeRegistry();
    const driver = new EvmBlockHeadPollerDriver(registry as never);
    const listener = vi.fn();

    await driver.start({ kind: 'evm-block-head-poller', listener }, FAKE_CTX, CHAIN_CFG as never);

    expect(registry.getOrCreate).toHaveBeenCalledWith(CHAIN_CFG);
  });

  it('start() wires spec.listener via headTracker.onHead', async () => {
    const headTracker = makeHeadTracker();
    const registry = makeRegistry(headTracker);
    const driver = new EvmBlockHeadPollerDriver(registry as never);
    const listener = vi.fn();

    await driver.start({ kind: 'evm-block-head-poller', listener }, FAKE_CTX, CHAIN_CFG as never);

    expect(headTracker.onHead).toHaveBeenCalledWith(listener);
  });

  it('stop() unsubscribes from headTracker', async () => {
    const headTracker = makeHeadTracker();
    const registry = makeRegistry(headTracker);
    const driver = new EvmBlockHeadPollerDriver(registry as never);
    const listener = vi.fn();

    const handle = await driver.start(
      { kind: 'evm-block-head-poller', listener },
      FAKE_CTX,
      CHAIN_CFG as never,
    );
    await handle.stop();

    expect(headTracker._unsub).toHaveBeenCalled();
  });

  it('two start() calls for different chains each get their own subscription', async () => {
    const trackerA = makeHeadTracker();
    const trackerB = makeHeadTracker();
    const ctxA = { headTracker: trackerA, client: {}, chainCfg: CHAIN_CFG };
    const ctxB = { headTracker: trackerB, client: {}, chainCfg: { ...CHAIN_CFG, chainId: '0x89' } };

    const registry = {
      getOrCreate: vi.fn().mockResolvedValueOnce(ctxA).mockResolvedValueOnce(ctxB),
    };
    const driver = new EvmBlockHeadPollerDriver(registry as never);

    await driver.start(
      { kind: 'evm-block-head-poller', listener: vi.fn() },
      FAKE_CTX,
      CHAIN_CFG as never,
    );
    await driver.start({ kind: 'evm-block-head-poller', listener: vi.fn() }, FAKE_CTX, {
      ...CHAIN_CFG,
      chainId: '0x89',
    } as never);

    expect(trackerA.onHead).toHaveBeenCalledTimes(1);
    expect(trackerB.onHead).toHaveBeenCalledTimes(1);
  });
});
