import { beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { DaoSourceRepository, DelegateDiscoveryRepository } from '@libs/db';
import { createAaveDelegationPowerSweepPlugin } from './delegation-power-sweep-plugin';
import { AAVE_TOKEN_SUPPORTED_CHAIN_IDS } from './plugin';

function makeDeps() {
  return {
    discovery: { findKnownDelegateAddresses: vi.fn() } as unknown as DelegateDiscoveryRepository,
    writer: { insertBatch: vi.fn() },
    daoIdResolver: { findDaoIdForSource: vi.fn() } as unknown as DaoSourceRepository,
    logger: silentLogger,
  };
}

const CTX = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_token_delegation_sweep',
  chainId: '0x1',
  sourceLabel: 'aave_token_delegation_sweep',
};

describe('createAaveDelegationPowerSweepPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the sweep source type and mainnet support', () => {
    const plugin = createAaveDelegationPowerSweepPlugin(makeDeps());
    expect(plugin.sourceType).toBe('aave_token_delegation_sweep');
    expect(plugin.supportedChainIds).toEqual(AAVE_TOKEN_SUPPORTED_CHAIN_IDS);
  });

  it('parses config with the shared Aave token schema', () => {
    const plugin = createAaveDelegationPowerSweepPlugin(makeDeps());
    expect(
      plugin.parseConfig({ token_address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9' }),
    ).toMatchObject({
      token_address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    });
  });

  it('buildIngestSpec returns evm-block-head-poller with a listener', () => {
    const plugin = createAaveDelegationPowerSweepPlugin(makeDeps());
    const spec = plugin.buildIngestSpec(CTX as never, {
      token_address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    });
    expect(spec.kind).toBe('evm-block-head-poller');
    expect(spec.listener).toBeTypeOf('function');
  });

  it('listener skips when headBlock is below headLag', async () => {
    const deps = makeDeps();
    const plugin = createAaveDelegationPowerSweepPlugin(deps);
    const spec = plugin.buildIngestSpec(CTX as never, {
      token_address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    });
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: {
        chainId: '0x1',
        blockNumber: 0n,
        blockHash: '0x',
        parentHash: '0x',
        timestamp: 0n,
        observedAt: new Date(),
      },
      chainCfg: { chainId: '0x1', name: 'ethereum', headLag: 12, providers: [] } as never,
      headBlock: 11n,
      client: { send: vi.fn() } as never,
    });

    await new Promise<void>((r) => setTimeout(r, 10));
    expect(deps.daoIdResolver.findDaoIdForSource).not.toHaveBeenCalled();
  });

  it('listener calls driver.onConfirmedHead when headBlock exceeds headLag', async () => {
    const deps = makeDeps();
    (deps.daoIdResolver.findDaoIdForSource as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    const plugin = createAaveDelegationPowerSweepPlugin(deps);
    const spec = plugin.buildIngestSpec(CTX as never, {
      token_address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    });
    if (spec.kind !== 'evm-block-head-poller') throw new Error('wrong kind');

    spec.listener({
      head: {
        chainId: '0x1',
        blockNumber: 0n,
        blockHash: '0x',
        parentHash: '0x',
        timestamp: 0n,
        observedAt: new Date(),
      },
      chainCfg: { chainId: '0x1', name: 'ethereum', headLag: 12, providers: [] } as never,
      headBlock: 1000n,
      client: { send: vi.fn() } as never,
    });

    await new Promise<void>((r) => setTimeout(r, 50));
    expect(deps.daoIdResolver.findDaoIdForSource).toHaveBeenCalledWith(CTX.daoSourceId);
  });

  it('omits buildBackfillRuntime — not backfillable', () => {
    const plugin = createAaveDelegationPowerSweepPlugin(makeDeps());
    expect(plugin.buildBackfillRuntime).toBeUndefined();
  });
});
