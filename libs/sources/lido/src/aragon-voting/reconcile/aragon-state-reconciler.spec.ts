import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import { AragonStateReconciler } from './aragon-state-reconciler';
import { GET_VOTE_INTERFACE } from '../abi/get-vote';
import type { AragonStaleReconciliationRow } from '../persistence/aragon-proposal-repository';

const VOTING = '0x2e59a20f205bb85a89c53f1936454680651e618e';

function row(overrides: Partial<AragonStaleReconciliationRow> = {}): AragonStaleReconciliationRow {
  return {
    id: 'p-1',
    source_id: '170',
    source_type: 'aragon_voting',
    chain_id: '0x1',
    voting_address: VOTING,
    state: 'active',
    support_required_pct: null,
    ...overrides,
  };
}

function getVoteResult(o: {
  open: boolean;
  executed: boolean;
  yea: bigint;
  nay: bigint;
  votingPower: bigint;
  supportRequired?: bigint;
  minAcceptQuorum?: bigint;
  script?: string;
  phase?: number;
}): string {
  return GET_VOTE_INTERFACE.encodeFunctionResult('getVote', [
    o.open,
    o.executed,
    1_700_000_000n,
    18_000_000n,
    o.supportRequired ?? 500_000_000_000_000_000n,
    o.minAcceptQuorum ?? 50_000_000_000_000_000n,
    o.yea,
    o.nay,
    o.votingPower,
    o.script ?? '0x00000001',
    o.phase ?? 2,
  ]);
}

function build(getVoteHex: string) {
  const send = vi.fn(async (method: string) => {
    if (method === 'eth_call') return getVoteHex;
    if (method === 'eth_getBlockByNumber') return { timestamp: '0x655d8d80' };
    throw new Error(`unexpected ${method}`);
  });
  const proposals = {
    markReconcileChecked: vi.fn().mockResolvedValue(undefined),
    fillSupportQuorum: vi.fn().mockResolvedValue(undefined),
    reconcileState: vi.fn().mockResolvedValue(1),
  };
  const proposalRepo = { insertActions: vi.fn().mockResolvedValue(1) };
  const reconciler = new AragonStateReconciler(
    silentLogger,
    ['aragon_voting'],
    proposalRepo as never,
  );
  const args = {
    proposals: proposals as never,
    confirmedThreshold: 18_500_000n,
    confirmedThresholdTag: '0x11a52a0',
    chainCtx: { client: { send }, chainCfg: { chainId: '0x1' } },
  };
  return { reconciler, proposals, proposalRepo, send, args };
}

describe('AragonStateReconciler', () => {
  it('enriches (actions then pct) and writes succeeded for a closed passing vote', async () => {
    const { reconciler, proposals, proposalRepo, args } = build(
      getVoteResult({ open: false, executed: false, yea: 700n, nay: 100n, votingPower: 1000n }),
    );
    const outcome = await reconciler.reconcileRow({ row: row(), ...args });

    expect(proposals.markReconcileChecked).toHaveBeenCalledWith('p-1', '18500000');
    expect(proposalRepo.insertActions).toHaveBeenCalled();
    expect(proposals.fillSupportQuorum).toHaveBeenCalledWith('p-1', {
      supportRequiredPct: '500000000000000000',
      minAcceptQuorumPct: '50000000000000000',
    });
    expect(proposals.reconcileState).toHaveBeenCalledWith(
      expect.objectContaining({ expectedStates: ['active'], targetState: 'succeeded' }),
    );
    expect(outcome).toEqual({ outcome: 'corrected', fromState: 'active', toState: 'succeeded' });
  });

  it('writes defeated when support fails at close', async () => {
    const { reconciler, proposals, args } = build(
      getVoteResult({ open: false, executed: false, yea: 100n, nay: 700n, votingPower: 1000n }),
    );
    const outcome = await reconciler.reconcileRow({ row: row(), ...args });
    expect(proposals.reconcileState).toHaveBeenCalledWith(
      expect.objectContaining({ targetState: 'defeated' }),
    );
    expect(outcome).toMatchObject({ outcome: 'corrected', toState: 'defeated' });
  });

  it('treats zero votes cast as defeated (no divide-by-zero)', async () => {
    const { reconciler, proposals, args } = build(
      getVoteResult({ open: false, executed: false, yea: 0n, nay: 0n, votingPower: 1000n }),
    );
    await reconciler.reconcileRow({ row: row(), ...args });
    expect(proposals.reconcileState).toHaveBeenCalledWith(
      expect.objectContaining({ targetState: 'defeated' }),
    );
  });

  it('returns enriched for an open vote (no state write)', async () => {
    const { reconciler, proposals, args } = build(
      getVoteResult({
        open: true,
        executed: false,
        yea: 1n,
        nay: 0n,
        votingPower: 1000n,
        phase: 0,
      }),
    );
    const outcome = await reconciler.reconcileRow({ row: row(), ...args });
    expect(outcome).toEqual({ outcome: 'enriched' });
    expect(proposals.reconcileState).not.toHaveBeenCalled();
  });

  it('returns still_open when already enriched and still open', async () => {
    const { reconciler, proposalRepo, args } = build(
      getVoteResult({
        open: true,
        executed: false,
        yea: 1n,
        nay: 0n,
        votingPower: 1000n,
        phase: 0,
      }),
    );
    const outcome = await reconciler.reconcileRow({
      row: row({ support_required_pct: '500000000000000000' }),
      ...args,
    });
    expect(outcome).toEqual({ outcome: 'still_open' });
    expect(proposalRepo.insertActions).not.toHaveBeenCalled();
  });

  it('surfaces missed_event when on-chain executed but local is not', async () => {
    const { reconciler, proposals, args } = build(
      getVoteResult({ open: false, executed: true, yea: 700n, nay: 100n, votingPower: 1000n }),
    );
    const outcome = await reconciler.reconcileRow({
      row: row({ support_required_pct: '1', state: 'succeeded' }),
      ...args,
    });
    expect(outcome).toEqual({ outcome: 'missed_event' });
    expect(proposals.reconcileState).not.toHaveBeenCalled();
  });

  it('returns guard_skipped when the state write hits the guard', async () => {
    const { reconciler, proposals, args } = build(
      getVoteResult({ open: false, executed: false, yea: 700n, nay: 100n, votingPower: 1000n }),
    );
    proposals.reconcileState.mockResolvedValue(0);
    const outcome = await reconciler.reconcileRow({
      row: row({ support_required_pct: '1' }),
      ...args,
    });
    expect(outcome).toEqual({ outcome: 'guard_skipped' });
  });
});
