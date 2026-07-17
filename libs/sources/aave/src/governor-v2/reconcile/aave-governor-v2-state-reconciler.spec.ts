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
const CREATOR = '0x' + '01'.repeat(20);
const STRATEGY = '0x' + '02'.repeat(20);
const ZERO32 = '0x' + '00'.repeat(32);

const BY_ID_SELECTOR = GOVERNOR_V2_STATE_INTERFACE.getFunction('getProposalById')!.selector;
const GRACE_SELECTOR = EXECUTOR_GRACE_PERIOD_INTERFACE.getFunction('GRACE_PERIOD')!.selector;

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

/** Encode a getProposalById result from the fields the reconciler actually reads. */
function encodeProposal(f: {
  executor?: string;
  startBlock?: bigint;
  endBlock?: bigint;
  executionTime?: bigint;
  executed?: boolean;
  canceled?: boolean;
}): string {
  return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionResult('getProposalById', [
    [
      5n,
      CREATOR,
      f.executor ?? EXECUTOR_ADDR,
      [],
      [],
      [],
      [],
      [],
      f.startBlock ?? 11_500_000n,
      f.endBlock ?? 11_550_000n,
      f.executionTime ?? 0n,
      0n, // forVotes — unused by the reconciler
      0n, // againstVotes — unused
      f.executed ?? false,
      f.canceled ?? false,
      STRATEGY,
      ZERO32,
    ],
  ]);
}

/** A client.send that dispatches getProposalById / GRACE_PERIOD / eth_getBlockByNumber by selector. */
function makeSend(opts: { proposal: string; grace?: bigint | string; blockTimestampHex?: string }) {
  return vi.fn(async (method: string, params: unknown[]) => {
    if (method === 'eth_getBlockByNumber') return { timestamp: opts.blockTimestampHex ?? '0x64' };
    if (method === 'eth_call') {
      const data = (params[0] as { data: string }).data;
      if (data.startsWith(BY_ID_SELECTOR)) return opts.proposal;
      if (data.startsWith(GRACE_SELECTOR)) {
        return typeof opts.grace === 'string'
          ? opts.grace
          : EXECUTOR_GRACE_PERIOD_INTERFACE.encodeFunctionResult('GRACE_PERIOD', [
              opts.grace ?? 86_400n,
            ]);
      }
    }
    throw new Error(`unexpected send: ${method}`);
  });
}

function make() {
  return new AaveGovernorV2StateReconciler(makeLogger() as never, ['aave_governor_v2']);
}

describe('AaveGovernorV2StateReconciler', () => {
  it('reads getProposalById, never the reverting getProposalState', async () => {
    const proposals = makeProposals();
    // confirmedThreshold below the proposal's start block → still pending on-chain.
    const send = makeSend({ proposal: encodeProposal({ startBlock: 13_000_000n }) });

    await make().reconcileRow({
      row: makeRow({ state: 'pending' }),
      confirmedThreshold: 12_000_000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    // Every eth_call must target getProposalById or GRACE_PERIOD — never getProposalState.
    const stateSel = GOVERNOR_V2_STATE_INTERFACE.getFunction('getProposalState')!.selector;
    for (const call of send.mock.calls) {
      if (call[0] === 'eth_call') {
        expect((call[1] as [{ data: string }])[0].data.startsWith(stateSel)).toBe(false);
      }
    }
  });

  it('returns already_consistent when the derived state equals local state', async () => {
    const proposals = makeProposals();
    const send = makeSend({ proposal: encodeProposal({ startBlock: 13_000_000n }) }); // pending

    const result = await make().reconcileRow({
      row: makeRow({ state: 'pending' }),
      confirmedThreshold: 12_000_000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'already_consistent' });
    expect(proposals.reconcileState).not.toHaveBeenCalled();
  });

  it('corrects pending→active using the voting_starts_block timestamp', async () => {
    const proposals = makeProposals();
    // confirmed head between start and end block → active.
    const send = makeSend({
      proposal: encodeProposal({ startBlock: 11_500_000n, endBlock: 13_000_000n }),
      blockTimestampHex: '0x64', // 100
    });

    const result = await make().reconcileRow({
      row: makeRow({ state: 'pending', voting_starts_block: '11500000' }),
      confirmedThreshold: 12_000_000n,
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

  it('corrects a concluded, never-queued proposal to defeated', async () => {
    // executionTime 0 + confirmed head past endBlock = never queued, voting over → defeated.
    // This is the case that could never resolve before: getProposalState reverted for it.
    const proposals = makeProposals();
    const send = makeSend({
      proposal: encodeProposal({ endBlock: 11_550_000n, executionTime: 0n }),
      blockTimestampHex: '0x200',
    });

    const result = await make().reconcileRow({
      row: makeRow({ state: 'pending', voting_ends_block: '11550000' }),
      confirmedThreshold: 12_000_000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'corrected', fromState: 'pending', toState: 'defeated' });
    expect(proposals.reconcileState).toHaveBeenCalledWith(
      expect.objectContaining({ targetState: 'defeated', stateUpdatedAt: new Date(512_000) }),
    );
  });

  it('returns guard_skipped for defeated when voting_ends_block is null', async () => {
    const send = makeSend({ proposal: encodeProposal({ executionTime: 0n }) });

    const result = await make().reconcileRow({
      row: makeRow({ state: 'pending', voting_ends_block: null }),
      confirmedThreshold: 12_000_000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: makeProposals() as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('corrects queued→expired once past the executor grace window', async () => {
    const proposals = makeProposals();
    const EXECUTION_TIME = 1_700_000_000n;
    const GRACE = 86_400n;
    // head timestamp AFTER executionTime + grace → expired.
    const headHex = '0x' + (Number(EXECUTION_TIME) + Number(GRACE) + 10).toString(16);
    const send = makeSend({
      proposal: encodeProposal({ executionTime: EXECUTION_TIME }),
      grace: GRACE,
      blockTimestampHex: headHex,
    });

    const result = await make().reconcileRow({
      row: makeRow({ state: 'queued' }),
      confirmedThreshold: 12_000_000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'corrected', fromState: 'queued', toState: 'expired' });
    expect(proposals.reconcileState).toHaveBeenCalledWith(
      expect.objectContaining({
        targetState: 'expired',
        stateUpdatedAt: new Date((Number(EXECUTION_TIME) + Number(GRACE)) * 1000),
      }),
    );
  });

  it('returns missed_event for a still-queued proposal within the grace window', async () => {
    // Queued on-chain but not yet expired — the ProposalQueued event should have been ingested.
    const proposals = makeProposals();
    const EXECUTION_TIME = 1_700_000_000n;
    const headHex = '0x' + (Number(EXECUTION_TIME) + 10).toString(16); // before expiry
    const send = makeSend({
      proposal: encodeProposal({ executionTime: EXECUTION_TIME }),
      grace: 86_400n,
      blockTimestampHex: headHex,
    });

    const result = await make().reconcileRow({
      row: makeRow({ state: 'pending' }),
      confirmedThreshold: 12_000_000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'missed_event' });
    expect(proposals.reconcileState).not.toHaveBeenCalled();
  });

  it('returns missed_event for canceled/executed on-chain states', async () => {
    for (const proposal of [
      encodeProposal({ canceled: true }),
      encodeProposal({ executed: true }),
    ]) {
      const proposals = makeProposals();
      const result = await make().reconcileRow({
        row: makeRow({ state: 'pending' }),
        confirmedThreshold: 12_000_000n,
        confirmedThresholdTag: '0xb71b00',
        proposals: proposals as never,
        chainCtx: {
          client: { send: makeSend({ proposal }) },
          chainCfg: { chainId: '0x1' },
        },
      });
      expect(result.outcome).toBe('missed_event');
      expect(proposals.reconcileState).not.toHaveBeenCalled();
    }
  });

  it('caches GRACE_PERIOD per executor across rows', async () => {
    const proposals = makeProposals();
    const EXECUTION_TIME = 1_700_000_000n;
    const headHex = '0x' + (Number(EXECUTION_TIME) + 200_000).toString(16);
    const send = makeSend({
      proposal: encodeProposal({ executionTime: EXECUTION_TIME }),
      grace: 86_400n,
      blockTimestampHex: headHex,
    });
    const reconciler = make();
    const base = {
      confirmedThreshold: 12_000_000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    };

    await reconciler.reconcileRow({ row: makeRow({ state: 'queued' }), ...base });
    const graceCalls = () =>
      send.mock.calls.filter(
        (c) =>
          c[0] === 'eth_call' && (c[1] as [{ data: string }])[0].data.startsWith(GRACE_SELECTOR),
      ).length;
    expect(graceCalls()).toBe(1);

    await reconciler.reconcileRow({ row: makeRow({ id: 'p2', state: 'queued' }), ...base });
    // Second row reuses the cached grace period — no additional GRACE_PERIOD call.
    expect(graceCalls()).toBe(1);
  });

  it('returns guard_skipped when GRACE_PERIOD is out of the valid range', async () => {
    const send = makeSend({
      proposal: encodeProposal({ executionTime: 1_700_000_000n }),
      grace: 0n, // below AAVE_V2_GRACE_MIN_SECONDS
    });

    const result = await make().reconcileRow({
      row: makeRow({ state: 'queued' }),
      confirmedThreshold: 12_000_000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: makeProposals() as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('rethrows AaveGovernorV2StateDecodeError from a bad GRACE_PERIOD result', async () => {
    const send = makeSend({
      proposal: encodeProposal({ executionTime: 1_700_000_000n }),
      grace: '0xdeadbeef', // undecodable
    });

    await expect(
      make().reconcileRow({
        row: makeRow({ state: 'queued' }),
        confirmedThreshold: 12_000_000n,
        confirmedThresholdTag: '0xb71b00',
        proposals: makeProposals() as never,
        chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
      }),
    ).rejects.toThrow(AaveGovernorV2StateDecodeError);
  });

  it('returns guard_skipped when reconcileState updates 0 rows', async () => {
    const proposals = { ...makeProposals(), reconcileState: vi.fn().mockResolvedValue(0) };
    const send = makeSend({
      proposal: encodeProposal({ startBlock: 11_500_000n, endBlock: 13_000_000n }),
      blockTimestampHex: '0x64',
    });

    const result = await make().reconcileRow({
      row: makeRow({ voting_starts_block: '11500000' }),
      confirmedThreshold: 12_000_000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('marks the row reconcile-checked with the stringified confirmedThreshold', async () => {
    const proposals = makeProposals();
    const send = makeSend({ proposal: encodeProposal({ startBlock: 13_000_000n }) });

    await make().reconcileRow({
      row: makeRow({ state: 'pending' }),
      confirmedThreshold: 12_000_000n,
      confirmedThresholdTag: '0xb71b00',
      proposals: proposals as never,
      chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
    });

    expect(proposals.markReconcileChecked).toHaveBeenCalledWith('proposal-v2-1', '12000000');
  });
});
