import { Interface } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { CompoundStateReconciler } from './compound-state-reconciler';
import {
  GOVERNOR_STATE_INTERFACE,
  TIMELOCK_INTERFACE,
  GovernorStateDecodeError,
} from '../abi/governor-state';

const TOKEN = '0xc00e94cb662c3520282e6f5717214004a7f26888';
const ERC20 = new Interface(['function totalSupply() view returns (uint256)']);

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeProposalRepo() {
  return { fillEligibleVotingPower: vi.fn().mockResolvedValue(undefined) };
}

describe('CompoundStateReconciler', () => {
  it('reconciles oz governor row to defeated using voting_ends_block timestamp', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn().mockResolvedValue(1),
    };

    const send = vi.fn(async (method: string, params: unknown[]) => {
      if (method === 'eth_call') {
        const request = params[0] as { to: string };
        if (request.to.toLowerCase() === '0x309a862bbc1a00e45506cb8a802d1ff10004c8c0') {
          return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [3n]); // defeated
        }
      }
      if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' }; // 100
      throw new Error(`unexpected rpc call: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: {
        id: 'proposal-oz-1',
        source_id: '394',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0x309a862bbC1A00e45506cB8A802D1ff10004c8C0',
        state: 'pending',
        voting_starts_block: '21690000',
        voting_ends_block: '21690100',
        queued_at_block: null,
        eligible_voting_power: '1000',
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 21699999n,
      confirmedThresholdTag: '0x14b063f',
      proposals: proposals as never,
      chainCtx: {
        client: { send },
        chainCfg: { chainId: '0x1' },
      },
    });

    expect(result).toEqual({
      outcome: 'corrected',
      fromState: 'pending',
      toState: 'defeated',
    });
    expect(proposals.markReconcileChecked).toHaveBeenCalledWith('proposal-oz-1', '21699999');
    expect(proposals.reconcileState).toHaveBeenCalledWith({
      proposalId: 'proposal-oz-1',
      expectedStates: ['pending', 'active', 'succeeded', 'queued'],
      targetState: 'defeated',
      stateUpdatedAt: new Date(100_000),
    });
  });

  it('returns already_consistent when onchain state equals local state', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn(),
    };

    const send = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [0n]); // pending
      }
      throw new Error(`unexpected: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: {
        id: 'p1',
        source_id: '1',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'pending',
        voting_starts_block: '100',
        voting_ends_block: '200',
        queued_at_block: null,
        eligible_voting_power: '1000',
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'already_consistent' });
    expect(proposals.reconcileState).not.toHaveBeenCalled();
  });

  it('returns missed_event when onchain state is executed', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn(),
    };

    const send = vi.fn(
      async () => GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [7n]), // executed
    );

    const result = await reconciler.reconcileRow({
      row: {
        id: 'p2',
        source_id: '2',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'pending',
        voting_starts_block: '100',
        voting_ends_block: '200',
        queued_at_block: null,
        eligible_voting_power: '1000',
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'missed_event' });
  });

  it('returns expired_no_queued_at_block when state is expired but queued_at_block is null', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn(),
    };

    const send = vi.fn(
      async () => GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [6n]), // expired
    );

    const result = await reconciler.reconcileRow({
      row: {
        id: 'p3',
        source_id: '3',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'queued',
        voting_starts_block: null,
        voting_ends_block: null,
        queued_at_block: null,
        eligible_voting_power: null,
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'expired_no_queued_at_block' });
  });

  it('returns guard_skipped for defeated when voting_ends_block is null', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn(),
    };

    const send = vi.fn(
      async () => GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [3n]), // defeated
    );

    const result = await reconciler.reconcileRow({
      row: {
        id: 'p4',
        source_id: '4',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'pending',
        voting_starts_block: null,
        voting_ends_block: null,
        queued_at_block: null,
        eligible_voting_power: null,
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('returns guard_skipped for active when voting_starts_block is null', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn(),
    };

    const send = vi.fn(
      async () => GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [1n]), // active
    );

    const result = await reconciler.reconcileRow({
      row: {
        id: 'p5',
        source_id: '5',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'pending',
        voting_starts_block: null,
        voting_ends_block: null,
        queued_at_block: null,
        eligible_voting_power: null,
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('returns guard_skipped when reconcileState returns 0', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn().mockResolvedValue(0), // no rows updated
    };

    const send = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [3n]); // defeated
      }
      if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' };
      throw new Error(`unexpected: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: {
        id: 'p6',
        source_id: '6',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'pending',
        voting_starts_block: '100',
        voting_ends_block: '200',
        queued_at_block: null,
        eligible_voting_power: '1000',
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('throws when readBlockTimestamp gets a response without a timestamp field', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn(),
    };

    const send = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [3n]); // defeated
      }
      if (method === 'eth_getBlockByNumber') return {}; // no timestamp
      throw new Error(`unexpected: ${method}`);
    });

    await expect(
      reconciler.reconcileRow({
        row: {
          id: 'p7',
          source_id: '7',
          source_type: 'compound_governor_oz',
          chain_id: '0x1',
          governor_address: '0xGov',
          state: 'pending',
          voting_starts_block: '100',
          voting_ends_block: '200',
          queued_at_block: null,
          eligible_voting_power: '1000',
          primary_token_address: TOKEN,
        },
        confirmedThreshold: 999n,
        confirmedThresholdTag: '0x3e7',
        proposals: proposals as never,
        chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
      }),
    ).rejects.toThrow('missing timestamp');
  });

  it('returns corrected for expired state with full timelock resolution and cache hit', async () => {
    const TIMELOCK_ADDR = '0x' + 'aa'.repeat(20);
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn().mockResolvedValue(1),
    };

    let ethCallCount = 0;
    const mockSend = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        ethCallCount++;
        if (ethCallCount === 1) return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [6n]); // expired
        if (ethCallCount === 2)
          return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('timelock', [TIMELOCK_ADDR]); // timelock address
        // 3rd and 4th calls: GRACE_PERIOD and delay (can use same encoding since both return uint256)
        return TIMELOCK_INTERFACE.encodeFunctionResult('GRACE_PERIOD', [86400n]); // 24h
      }
      if (method === 'eth_getBlockByNumber') return { timestamp: '0x1000' }; // block timestamp
      throw new Error(`unexpected: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: {
        id: 'p8',
        source_id: '8',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'queued',
        voting_starts_block: '100',
        voting_ends_block: '200',
        queued_at_block: '210',
        eligible_voting_power: '1000',
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send: mockSend }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'corrected', fromState: 'queued', toState: 'expired' });

    // Second call should hit the timelock cache
    ethCallCount = 0;
    const result2 = await reconciler.reconcileRow({
      row: {
        id: 'p9',
        source_id: '9',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'queued',
        voting_starts_block: '100',
        voting_ends_block: '200',
        queued_at_block: '210',
        eligible_voting_power: '1000',
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send: mockSend }, chainCfg: { chainId: '0x1' } },
    });
    // Cache hit: only 1 eth_call (the state() call), no timelock/GRACE_PERIOD/delay
    expect(ethCallCount).toBe(1);
    expect(result2.outcome).toBe('corrected');
  });

  it('returns expired_no_queued_at_block when resolveTimelockParams returns null (validateSeconds fails)', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn(),
    };

    let ethCallCount = 0;
    const mockSend = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        ethCallCount++;
        if (ethCallCount === 1) return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [6n]);
        if (ethCallCount === 2)
          return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('timelock', [
            '0x' + 'bb'.repeat(20),
          ]);
        // GRACE_PERIOD and delay return 0 → validateSeconds fails (0 < min=3600)
        return TIMELOCK_INTERFACE.encodeFunctionResult('GRACE_PERIOD', [0n]);
      }
      throw new Error(`unexpected: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: {
        id: 'p10',
        source_id: '10',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'queued',
        voting_starts_block: null,
        voting_ends_block: null,
        queued_at_block: '100',
        eligible_voting_power: null,
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send: mockSend }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'expired_no_queued_at_block' });
  });

  it('rethrows GovernorStateDecodeError from resolveTimelockParams', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn(),
    };

    let ethCallCount = 0;
    const mockSend = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        ethCallCount++;
        if (ethCallCount === 1) return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [6n]);
        // Second call (timelock) returns garbage → GovernorStateDecodeError
        return '0xdeadbeef';
      }
      throw new Error(`unexpected: ${method}`);
    });

    await expect(
      reconciler.reconcileRow({
        row: {
          id: 'p11',
          source_id: '11',
          source_type: 'compound_governor_oz',
          chain_id: '0x1',
          governor_address: '0xGov',
          state: 'queued',
          voting_starts_block: null,
          voting_ends_block: null,
          queued_at_block: '100',
          eligible_voting_power: null,
          primary_token_address: TOKEN,
        },
        confirmedThreshold: 999n,
        confirmedThresholdTag: '0x3e7',
        proposals: proposals as never,
        chainCtx: { client: { send: mockSend }, chainCfg: { chainId: '0x1' } },
      }),
    ).rejects.toThrow(GovernorStateDecodeError);
  });

  it('returns guard_skipped when mapped state has no timestamp branch (e.g. succeeded)', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn(),
    };

    const send = vi.fn(
      async () => GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [4n]), // succeeded → no timestamp branch
    );

    const result = await reconciler.reconcileRow({
      row: {
        id: 'p99',
        source_id: '99',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'active', // local active, on-chain succeeded → stateUpdatedAt stays null
        voting_starts_block: null,
        voting_ends_block: null,
        queued_at_block: null,
        eligible_voting_power: null,
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('catches non-GovernorStateDecodeError from resolveTimelockParams and returns null', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn(),
    };

    let ethCallCount = 0;
    const mockSend = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        ethCallCount++;
        if (ethCallCount === 1) return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [6n]);
        // Second call: throw a plain Error (not GovernorStateDecodeError) → caught → return null
        throw new Error('network timeout');
      }
      throw new Error(`unexpected: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: {
        id: 'p100',
        source_id: '100',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'queued',
        voting_starts_block: null,
        voting_ends_block: null,
        queued_at_block: '100',
        eligible_voting_power: null,
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send: mockSend }, chainCfg: { chainId: '0x1' } },
    });

    // resolveTimelockParams returns null → expired_no_queued_at_block
    expect(result).toEqual({ outcome: 'expired_no_queued_at_block' });
  });

  it('reconciles pending row to active when startBlock has been confirmed', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn().mockResolvedValue(1),
    };

    const send = vi.fn(async (method: string, params: unknown[]) => {
      if (method === 'eth_call') {
        const request = params[0] as { to: string };
        if (request.to.toLowerCase() === '0x309a862bbc1a00e45506cb8a802d1ff10004c8c0') {
          return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [1n]); // active
        }
      }
      if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' }; // 100
      throw new Error(`unexpected rpc call: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: {
        id: 'proposal-oz-2',
        source_id: '584',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0x309a862bbC1A00e45506cB8A802D1ff10004c8C0',
        state: 'pending',
        voting_starts_block: '21700000',
        voting_ends_block: '21740000',
        queued_at_block: null,
        eligible_voting_power: '1000',
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 21710000n,
      confirmedThresholdTag: '0x14b2f10',
      proposals: proposals as never,
      chainCtx: {
        client: { send },
        chainCfg: { chainId: '0x1' },
      },
    });

    expect(result).toEqual({ outcome: 'corrected', fromState: 'pending', toState: 'active' });
    expect(proposals.markReconcileChecked).toHaveBeenCalledWith('proposal-oz-2', '21710000');
    expect(proposals.reconcileState).toHaveBeenCalledWith({
      proposalId: 'proposal-oz-2',
      expectedStates: ['pending', 'active', 'succeeded', 'queued'],
      targetState: 'active',
      stateUpdatedAt: new Date(100_000),
    });
    const blockFetches = send.mock.calls.filter(([m]) => m === 'eth_getBlockByNumber');
    expect(blockFetches).toHaveLength(1);
    expect(blockFetches[0]![1]).toEqual([`0x${BigInt('21700000').toString(16)}`, false]);
  });

  it('fills eligible_voting_power when null and voting_starts_block is set', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn(),
    };

    const totalSupply = 10_000_000n * 10n ** 18n;
    const send = vi.fn(async (method: string, params: unknown[]) => {
      if (method === 'eth_call') {
        const req = params[0] as { to: string };
        if (req.to.toLowerCase() === '0xgov') {
          return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [0n]); // pending
        }
        if (req.to.toLowerCase() === TOKEN) {
          return ERC20.encodeFunctionResult('totalSupply', [totalSupply]);
        }
      }
      throw new Error(`unexpected: ${method}`);
    });

    await reconciler.reconcileRow({
      row: {
        id: 'p-vp',
        source_id: '42',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'pending',
        voting_starts_block: '500',
        voting_ends_block: '600',
        queued_at_block: null,
        eligible_voting_power: null,
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(proposalRepo.fillEligibleVotingPower).toHaveBeenCalledWith(
      'p-vp',
      totalSupply.toString(),
    );
    const tokenCalls = send.mock.calls.filter(
      ([m, p]) =>
        m === 'eth_call' &&
        (p as unknown[])[0] &&
        ((p as unknown[])[0] as { to: string }).to.toLowerCase() === TOKEN,
    );
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]![1][1]).toBe(`0x${BigInt('500').toString(16)}`);
  });

  it('skips totalSupply call when eligible_voting_power is already set', async () => {
    const proposalRepo = makeProposalRepo();
    const reconciler = new CompoundStateReconciler(
      makeLogger() as never,
      ['compound_governor_oz'],
      proposalRepo as never,
    );
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn(),
    };

    const send = vi.fn(async (method: string) => {
      if (method === 'eth_call') {
        return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [0n]); // pending
      }
      throw new Error(`unexpected: ${method}`);
    });

    await reconciler.reconcileRow({
      row: {
        id: 'p-vp-skip',
        source_id: '43',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0xGov',
        state: 'pending',
        voting_starts_block: '500',
        voting_ends_block: '600',
        queued_at_block: null,
        eligible_voting_power: '999000000000000000000',
        primary_token_address: TOKEN,
      },
      confirmedThreshold: 999n,
      confirmedThresholdTag: '0x3e7',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(proposalRepo.fillEligibleVotingPower).not.toHaveBeenCalled();
    // Only 1 eth_call (the state() call), no totalSupply call
    expect(send.mock.calls.filter(([m]) => m === 'eth_call')).toHaveLength(1);
  });
});
