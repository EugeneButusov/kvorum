import { AbiCoder } from 'ethers';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { NewDelegationFlowProjectionRow } from '@libs/db';
import {
  DelegationPowerSweepDriver,
  type DelegationPowerSweepDeps,
  type DelegationPowerSweepConfig,
  type DelegationPowerSweepHeadArgs,
} from './delegation-power-sweep-driver';

const TOKEN_ADDRESS = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';
const DELEGATE_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DELEGATE_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function encodePower(power: bigint): string {
  return AbiCoder.defaultAbiCoder().encode(['uint256'], [power]);
}

function makeDeps(overrides?: Partial<DelegationPowerSweepDeps>): DelegationPowerSweepDeps {
  return {
    discovery: { findKnownDelegateAddresses: vi.fn().mockResolvedValue([DELEGATE_A, DELEGATE_B]) },
    writer: { insertBatch: vi.fn().mockResolvedValue(undefined) },
    daoIdResolver: { findDaoIdForSource: vi.fn().mockResolvedValue('dao-1') },
    logger: silentLogger,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<DelegationPowerSweepConfig>): DelegationPowerSweepConfig {
  return {
    tokenAddress: TOKEN_ADDRESS,
    sweepCooldownBlocks: 0,
    batchSize: 50,
    ...overrides,
  };
}

function makeArgs(overrides?: Partial<DelegationPowerSweepHeadArgs>): DelegationPowerSweepHeadArgs {
  return {
    confirmedBlock: 100n,
    blockTag: '0x64',
    client: {
      send: vi.fn().mockResolvedValue(encodePower(1000n)),
    },
    daoSourceId: 'ds-1',
    ...overrides,
  };
}

describe('DelegationPowerSweepDriver', () => {
  let deps: DelegationPowerSweepDeps;
  let driver: DelegationPowerSweepDriver;
  let args: DelegationPowerSweepHeadArgs;

  beforeEach(() => {
    deps = makeDeps();
    driver = new DelegationPowerSweepDriver(deps, makeConfig());
    args = makeArgs();
  });

  it('writes votes_changed rows for each discovered delegate', async () => {
    await driver.onConfirmedHead(args);

    expect(deps.writer.insertBatch).toHaveBeenCalledTimes(1);
    const rows = vi.mocked(deps.writer.insertBatch).mock
      .calls[0]![0] as NewDelegationFlowProjectionRow[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.delegator_address).toBe(DELEGATE_A);
    expect(rows[0]!.delegate_address).toBe(DELEGATE_A);
    expect(rows[0]!.voting_power).toBe('1000');
    expect(rows[0]!.event_type).toBe('votes_changed');
    expect(rows[1]!.delegator_address).toBe(DELEGATE_B);
  });

  it('skips sweep when within cooldown window', async () => {
    driver = new DelegationPowerSweepDriver(deps, makeConfig({ sweepCooldownBlocks: 100 }));

    await driver.onConfirmedHead(args);
    expect(deps.writer.insertBatch).toHaveBeenCalledTimes(1);

    await driver.onConfirmedHead({ ...args, confirmedBlock: 150n, blockTag: '0x96' });
    expect(deps.writer.insertBatch).toHaveBeenCalledTimes(1);

    await driver.onConfirmedHead({ ...args, confirmedBlock: 201n, blockTag: '0xc9' });
    expect(deps.writer.insertBatch).toHaveBeenCalledTimes(2);
  });

  it('guards against concurrent sweeps', async () => {
    const slowDiscovery = {
      findKnownDelegateAddresses: vi
        .fn()
        .mockImplementation(
          () => new Promise<string[]>((resolve) => setTimeout(() => resolve([DELEGATE_A]), 50)),
        ),
    };
    deps = makeDeps({ discovery: slowDiscovery });
    driver = new DelegationPowerSweepDriver(deps, makeConfig());

    const p1 = driver.onConfirmedHead(args);
    const p2 = driver.onConfirmedHead({ ...args, confirmedBlock: 200n, blockTag: '0xc8' });

    await Promise.all([p1, p2]);

    expect(slowDiscovery.findKnownDelegateAddresses).toHaveBeenCalledTimes(1);
  });

  it('continues on individual RPC failures (partial results)', async () => {
    const client = {
      send: vi
        .fn()
        .mockResolvedValueOnce(encodePower(500n))
        .mockRejectedValueOnce(new Error('rpc timeout')),
    };
    args = makeArgs({ client });

    await driver.onConfirmedHead(args);

    const rows = vi.mocked(deps.writer.insertBatch).mock
      .calls[0]![0] as NewDelegationFlowProjectionRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.delegator_address).toBe(DELEGATE_A);
    expect(rows[0]!.voting_power).toBe('500');
  });

  it('does not write when all delegates have no data', async () => {
    deps = makeDeps({
      discovery: { findKnownDelegateAddresses: vi.fn().mockResolvedValue([]) },
    });
    driver = new DelegationPowerSweepDriver(deps, makeConfig());

    await driver.onConfirmedHead(args);

    expect(deps.writer.insertBatch).not.toHaveBeenCalled();
  });

  it('resolves daoId once and caches it', async () => {
    await driver.onConfirmedHead(args);
    await driver.onConfirmedHead({ ...args, confirmedBlock: 200n, blockTag: '0xc8' });

    expect(deps.daoIdResolver.findDaoIdForSource).toHaveBeenCalledTimes(1);
  });

  it('skips sweep when daoId cannot be resolved', async () => {
    deps = makeDeps({
      daoIdResolver: { findDaoIdForSource: vi.fn().mockResolvedValue(undefined) },
    });
    driver = new DelegationPowerSweepDriver(deps, makeConfig());

    await driver.onConfirmedHead(args);

    expect(deps.discovery.findKnownDelegateAddresses).not.toHaveBeenCalled();
    expect(deps.writer.insertBatch).not.toHaveBeenCalled();
  });

  it('produces deterministic delegation_id for same (address, block)', async () => {
    await driver.onConfirmedHead(args);
    const rows1 = vi.mocked(deps.writer.insertBatch).mock
      .calls[0]![0] as NewDelegationFlowProjectionRow[];

    driver = new DelegationPowerSweepDriver(deps, makeConfig());
    await driver.onConfirmedHead(args);
    const rows2 = vi.mocked(deps.writer.insertBatch).mock
      .calls[1]![0] as NewDelegationFlowProjectionRow[];

    expect(rows1[0]!.delegation_id).toBe(rows2[0]!.delegation_id);
  });

  it('includes zero-power delegates in the output', async () => {
    args = makeArgs({
      client: { send: vi.fn().mockResolvedValue(encodePower(0n)) },
    });

    await driver.onConfirmedHead(args);

    const rows = vi.mocked(deps.writer.insertBatch).mock
      .calls[0]![0] as NewDelegationFlowProjectionRow[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.voting_power).toBe('0');
    expect(rows[0]!.event_type).toBe('votes_changed');
  });
});
