import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainContextRegistry } from '@libs/chain';
import type { DaoSourceRepository } from '@libs/db';
import { AaveDelegationPowerSweepService } from './aave-delegation-power-sweep.service';

vi.mock('@libs/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@libs/db')>();
  return {
    ...actual,
    chDb: {},
    DelegateDiscoveryRepository: class {
      public findKnownDelegateAddresses = vi.fn();
    },
    DelegationFlowProjectionWriter: class {
      public insertBatch = vi.fn();
    },
  };
});

vi.mock('@sources/aave', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sources/aave')>();
  return {
    ...actual,
    DelegationPowerSweepDriver: class {
      onConfirmedHead = vi.fn();
    },
  };
});

function makeRegistry() {
  const unsub = vi.fn();
  const onHead = vi.fn().mockReturnValue(unsub);
  return {
    registry: {
      getOrCreate: vi.fn().mockResolvedValue({
        headTracker: { onHead },
        client: {},
        chainCfg: {},
      }),
    } as unknown as ChainContextRegistry,
    onHead,
    unsub,
  };
}

function makeDaoSourceRepo(sources: Array<{ id: string; source_type: string; chain_id: string }>) {
  return {
    findAll: vi.fn().mockResolvedValue(sources),
    findDaoIdForSource: vi.fn(),
  } as unknown as DaoSourceRepository;
}

const CHAIN_CONFIG = JSON.stringify({
  chains: [
    {
      chainId: '0x1',
      name: 'ethereum',
      headLag: 12,
      providers: [{ name: 'test', url: 'http://localhost:8545', kind: 'http', priority: 1 }],
    },
  ],
});

describe('AaveDelegationPowerSweepService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env['CHAIN_CONFIG'];
  });

  it('skips bootstrap when CHAIN_CONFIG is not set', async () => {
    const { registry } = makeRegistry();
    const repo = makeDaoSourceRepo([]);
    const service = new AaveDelegationPowerSweepService(registry, repo);

    await service.onApplicationBootstrap();

    expect(repo.findAll).not.toHaveBeenCalled();
  });

  it('skips bootstrap when mainnet is not in the chain config', async () => {
    process.env['CHAIN_CONFIG'] = JSON.stringify({
      chains: [
        {
          chainId: '0x89',
          name: 'polygon',
          headLag: 128,
          providers: [{ name: 'test', url: 'http://localhost:8546', kind: 'http', priority: 1 }],
        },
      ],
    });

    const { registry } = makeRegistry();
    const repo = makeDaoSourceRepo([]);
    const service = new AaveDelegationPowerSweepService(registry, repo);

    await service.onApplicationBootstrap();

    expect(registry.getOrCreate).not.toHaveBeenCalled();
  });

  it('skips bootstrap when no aave_token source for mainnet', async () => {
    process.env['CHAIN_CONFIG'] = CHAIN_CONFIG;

    const { registry } = makeRegistry();
    const repo = makeDaoSourceRepo([
      { id: 'dao-src-1', source_type: 'aave_governance_v3', chain_id: '0x1' },
    ]);
    const service = new AaveDelegationPowerSweepService(registry, repo);

    await service.onApplicationBootstrap();

    expect(registry.getOrCreate).not.toHaveBeenCalled();
  });

  it('subscribes to headTracker.onHead when configured', async () => {
    process.env['CHAIN_CONFIG'] = CHAIN_CONFIG;

    const { registry, onHead } = makeRegistry();
    const repo = makeDaoSourceRepo([
      { id: 'dao-src-token', source_type: 'aave_token', chain_id: '0x1' },
    ]);
    const service = new AaveDelegationPowerSweepService(registry, repo);

    await service.onApplicationBootstrap();

    expect(registry.getOrCreate).toHaveBeenCalled();
    expect(onHead).toHaveBeenCalledWith(expect.any(Function));
  });

  it('unsubscribes on shutdown', async () => {
    process.env['CHAIN_CONFIG'] = CHAIN_CONFIG;

    const { registry, unsub } = makeRegistry();
    const repo = makeDaoSourceRepo([
      { id: 'dao-src-token', source_type: 'aave_token', chain_id: '0x1' },
    ]);
    const service = new AaveDelegationPowerSweepService(registry, repo);

    await service.onApplicationBootstrap();
    await service.onApplicationShutdown();

    expect(unsub).toHaveBeenCalled();
  });

  it('listener skips when headBlock is below headLag', async () => {
    process.env['CHAIN_CONFIG'] = CHAIN_CONFIG;

    const { registry, onHead } = makeRegistry();
    const repo = makeDaoSourceRepo([
      { id: 'dao-src-token', source_type: 'aave_token', chain_id: '0x1' },
    ]);
    const service = new AaveDelegationPowerSweepService(registry, repo);

    await service.onApplicationBootstrap();

    const listener = onHead.mock.calls[0]![0] as (args: {
      chainCfg: { headLag: number };
      headBlock: bigint;
      client: unknown;
    }) => void;

    listener({
      chainCfg: { headLag: 12 },
      headBlock: 5n,
      client: {},
    });

    await new Promise<void>((r) => setTimeout(r, 10));
    expect(repo.findDaoIdForSource).not.toHaveBeenCalled();
  });
});
