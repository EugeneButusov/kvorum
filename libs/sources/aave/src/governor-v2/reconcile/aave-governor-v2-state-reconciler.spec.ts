import { describe, expect, it, vi } from 'vitest';
import { AaveGovernorV2StateReconciler } from './aave-governor-v2-state-reconciler';
import type { AaveStaleReconciliationRow } from '../../persistence/aave-proposal-repository';
import {
  GOVERNOR_V2_STATE_INTERFACE,
  EXECUTOR_GRACE_PERIOD_INTERFACE,
  AaveGovernorV2StateDecodeError,
} from '../abi/governor-state';

const EXECUTOR_ADDR = '0x' + 'ee'.repeat(20);
const GOVERNOR_ADDR = '0x' + 'aa'.repeat(20);

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeRow(overrides: Partial<AaveStaleReconciliationRow> = {}): AaveStaleReconciliationRow {
  return {
    id: 'proposal-v2-1',
    source_id: '5',
    source_type: 'aave_governor_v2',
    chain_id: '0x1',
    governance_address: GOVERNOR_ADDR,
    state: 'pending',
    creation_block: '11500000',
    voting_starts_block: '11500000',
    voting_ends_block: '11550000',
    ...overrides,
  };
}

function makeProposals() {
  return {
    markReconcileChecked: vi.fn().mockResolvedValue(undefined),
    reconcileState: vi.fn().mockResolvedValue(1),
  };
}

describe('AaveGovernorV2StateReconciler', () => {
  it('returns already_consistent when on-chain state equals local state', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);
    const proposals = makeProposals();

    const result = await reconciler.reconcileRow({
      row: makeRow({ state: 'pending' }),
      confirmedThreshold: 12000000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: {
        client: {
          send: vi.fn().mockResolvedValue(
            GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [0n]), // pending
          ),
        },
        chainCfg: { chainId: '0x1' },
      },
    });

    expect(result).toEqual({ outcome: 'already_consistent' });
    expect(proposals.reconcileState).not.toHaveBeenCalled();
  });

  it('corrects pending→active when voting_starts_block is confirmed', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);
    const proposals = makeProposals();

    const send = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [2n]); // active
      }
      if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' }; // 100
      throw new Error(`unexpected: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: makeRow({ state: 'pending', voting_starts_block: '11500000' }),
      confirmedThreshold: 12000000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'corrected', fromState: 'pending', toState: 'active' });
    expect(proposals.reconcileState).toHaveBeenCalledWith({
      proposalId: 'proposal-v2-1',
      expectedStates: ['pending', 'active', 'succeeded', 'queued'],
      targetState: 'active',
      stateUpdatedAt: new Date(100_000),
    });
  });

  it('returns guard_skipped for active when voting_starts_block is null', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);
    const proposals = makeProposals();

    const result = await reconciler.reconcileRow({
      row: makeRow({ state: 'pending', voting_starts_block: null }),
      confirmedThreshold: 12000000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: {
        client: {
          send: vi.fn().mockResolvedValue(
            GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [2n]), // active
          ),
        },
        chainCfg: { chainId: '0x1' },
      },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('returns guard_skipped when voting_starts_block is beyond confirmedThreshold', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);
    const proposals = makeProposals();

    const result = await reconciler.reconcileRow({
      row: makeRow({ state: 'pending', voting_starts_block: '13000000' }),
      confirmedThreshold: 12000000n, // block 13M is NOT yet confirmed
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: {
        client: {
          send: vi.fn().mockResolvedValue(
            GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [2n]), // active
          ),
        },
        chainCfg: { chainId: '0x1' },
      },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('corrects active→defeated using voting_ends_block timestamp', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);
    const proposals = makeProposals();

    const send = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [3n]); // defeated
      }
      if (method === 'eth_getBlockByNumber') return { timestamp: '0x200' };
      throw new Error(`unexpected: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: makeRow({ state: 'active', voting_ends_block: '11550000' }),
      confirmedThreshold: 12000000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'corrected', fromState: 'active', toState: 'defeated' });
  });

  it('returns guard_skipped for defeated when voting_ends_block is null', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);

    const result = await reconciler.reconcileRow({
      row: makeRow({ state: 'active', voting_ends_block: null }),
      confirmedThreshold: 12000000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: makeProposals() as never,
      chainCtx: {
        client: {
          send: vi.fn().mockResolvedValue(
            GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [3n]), // defeated
          ),
        },
        chainCfg: { chainId: '0x1' },
      },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('corrects queued→expired via getProposalById + GRACE_PERIOD', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);
    const proposals = makeProposals();
    const EXECUTION_TIME = 1_700_000_000n; // Unix timestamp
    const GRACE_PERIOD = 86_400n; // 1 day

    let ethCallCount = 0;
    const send = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        ethCallCount++;
        if (ethCallCount === 1) {
          // getProposalState → expired
          return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [6n]);
        }
        if (ethCallCount === 2) {
          // getProposalById → full struct
          return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalById', [
            [
              5n,
              '0x0000000000000000000000000000000000000001',
              EXECUTOR_ADDR,
              [],
              [],
              [],
              [],
              [],
              0n,
              0n,
              EXECUTION_TIME,
              0n,
              0n,
              false,
              false,
              '0x0000000000000000000000000000000000000002',
              '0x' + '00'.repeat(32),
            ],
          ]);
        }
        // GRACE_PERIOD call to executor
        return EXECUTOR_GRACE_PERIOD_INTERFACE.encodeFunctionResult('GRACE_PERIOD', [GRACE_PERIOD]);
      }
      throw new Error(`unexpected: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: makeRow({ state: 'queued' }),
      confirmedThreshold: 12000000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'corrected', fromState: 'queued', toState: 'expired' });
    expect(proposals.reconcileState).toHaveBeenCalledWith(
      expect.objectContaining({
        targetState: 'expired',
        stateUpdatedAt: new Date((Number(EXECUTION_TIME) + Number(GRACE_PERIOD)) * 1000),
      }),
    );
  });

  it('caches GRACE_PERIOD per executor on second call', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);
    const proposals = makeProposals();
    const EXECUTION_TIME = 1_700_000_000n;
    const CREATOR = '0x' + '01'.repeat(20);
    const STRATEGY = '0x' + '02'.repeat(20);

    let ethCallCount = 0;
    const send = vi.fn(async (method: string) => {
      if (method !== 'eth_call') throw new Error(`unexpected: ${method}`);
      ethCallCount++;
      if (ethCallCount === 1 || ethCallCount === 4) {
        return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [6n]); // expired
      }
      if (ethCallCount === 2 || ethCallCount === 5) {
        return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalById', [
          [
            5n,
            CREATOR,
            EXECUTOR_ADDR,
            [],
            [],
            [],
            [],
            [],
            0n,
            0n,
            EXECUTION_TIME,
            0n,
            0n,
            false,
            false,
            STRATEGY,
            '0x' + '00'.repeat(32),
          ],
        ]);
      }
      // eth_call count 3 = GRACE_PERIOD (first call, caches)
      return EXECUTOR_GRACE_PERIOD_INTERFACE.encodeFunctionResult('GRACE_PERIOD', [86400n]);
    });

    await reconciler.reconcileRow({
      row: makeRow({ state: 'queued' }),
      confirmedThreshold: 12000000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });
    // First reconcile: state + getProposalById + GRACE_PERIOD = 3 eth_call
    expect(ethCallCount).toBe(3);

    ethCallCount = 0;
    await reconciler.reconcileRow({
      row: makeRow({ id: 'p2', state: 'queued' }),
      confirmedThreshold: 12000000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });
    // Second reconcile: state + getProposalById only (GRACE_PERIOD cached)
    expect(ethCallCount).toBe(2);
  });

  it('returns missed_event for queued/executed/canceled/succeeded on-chain states', async () => {
    const missedStates = [5n, 7n, 1n, 4n]; // queued, executed, canceled, succeeded
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);

    for (const stateCode of missedStates) {
      const proposals = makeProposals();
      const result = await reconciler.reconcileRow({
        row: makeRow({ state: 'pending' }),
        confirmedThreshold: 12000000n,
        confirmedThresholdTag: '0xb71b00',
        proposals: proposals as never,
        chainCtx: {
          client: {
            send: vi
              .fn()
              .mockResolvedValue(
                GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [stateCode]),
              ),
          },
          chainCfg: { chainId: '0x1' },
        },
      });
      expect(result.outcome).toBe('missed_event');
    }
  });

  it('returns guard_skipped when reconcileState updates 0 rows', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);
    const proposals = { ...makeProposals(), reconcileState: vi.fn().mockResolvedValue(0) };

    const send = vi.fn(async (method: string) => {
      if (method === 'eth_call')
        return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [2n]); // active
      if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' };
      throw new Error(`unexpected: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: makeRow({ voting_starts_block: '11500000' }),
      confirmedThreshold: 12000000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('returns guard_skipped when executionTime is 0 (not yet queued)', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);
    const proposals = makeProposals();
    const CREATOR = '0x' + '01'.repeat(20);
    const STRATEGY = '0x' + '02'.repeat(20);

    let ethCallCount = 0;
    const send = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        ethCallCount++;
        if (ethCallCount === 1)
          return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [6n]); // expired
        return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalById', [
          [
            5n,
            CREATOR,
            EXECUTOR_ADDR,
            [],
            [],
            [],
            [],
            [],
            0n,
            0n,
            0n,
            0n,
            0n,
            false,
            false,
            STRATEGY,
            '0x' + '00'.repeat(32),
          ],
        ]);
      }
      throw new Error(`unexpected: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: makeRow({ state: 'queued' }),
      confirmedThreshold: 12000000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('rethrows AaveGovernorV2StateDecodeError from GRACE_PERIOD decode', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);
    const proposals = makeProposals();
    const CREATOR = '0x' + '01'.repeat(20);
    const STRATEGY = '0x' + '02'.repeat(20);

    let ethCallCount = 0;
    const send = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        ethCallCount++;
        if (ethCallCount === 1)
          return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [6n]);
        if (ethCallCount === 2)
          return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalById', [
            [
              5n,
              CREATOR,
              EXECUTOR_ADDR,
              [],
              [],
              [],
              [],
              [],
              0n,
              0n,
              1_700_000_000n,
              0n,
              0n,
              false,
              false,
              STRATEGY,
              '0x' + '00'.repeat(32),
            ],
          ]);
        return '0xdeadbeef'; // bad GRACE_PERIOD data → AaveGovernorV2StateDecodeError
      }
      throw new Error(`unexpected: ${method}`);
    });

    await expect(
      reconciler.reconcileRow({
        row: makeRow({ state: 'queued' }),
        confirmedThreshold: 12000000n,
        confirmedThresholdTag: '0xb71b00',
        proposals: proposals as never,
        chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
      }),
    ).rejects.toThrow(AaveGovernorV2StateDecodeError);
  });

  it('returns guard_skipped when GRACE_PERIOD is out of valid range', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);
    const proposals = makeProposals();
    const CREATOR = '0x' + '01'.repeat(20);
    const STRATEGY = '0x' + '02'.repeat(20);

    let ethCallCount = 0;
    const send = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        ethCallCount++;
        if (ethCallCount === 1)
          return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [6n]);
        if (ethCallCount === 2)
          return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalById', [
            [
              5n,
              CREATOR,
              EXECUTOR_ADDR,
              [],
              [],
              [],
              [],
              [],
              0n,
              0n,
              1_700_000_000n,
              0n,
              0n,
              false,
              false,
              STRATEGY,
              '0x' + '00'.repeat(32),
            ],
          ]);
        // GRACE_PERIOD = 0s — below AAVE_V2_GRACE_MIN_SECONDS=3600
        return EXECUTOR_GRACE_PERIOD_INTERFACE.encodeFunctionResult('GRACE_PERIOD', [0n]);
      }
      throw new Error(`unexpected: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: makeRow({ state: 'queued' }),
      confirmedThreshold: 12000000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('markReconcileChecked is called with string confirmedThreshold', async () => {
    const reconciler = new AaveGovernorV2StateReconciler(makeLogger() as never, [
      'aave_governor_v2',
    ]);
    const proposals = makeProposals();

    await reconciler.reconcileRow({
      row: makeRow({ state: 'pending' }),
      confirmedThreshold: 12000000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: {
        client: {
          send: vi
            .fn()
            .mockResolvedValue(
              GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalState', [0n]),
            ),
        },
        chainCfg: { chainId: '0x1' },
      },
    });

    expect(proposals.markReconcileChecked).toHaveBeenCalledWith('proposal-v2-1', '12000000');
  });
});
