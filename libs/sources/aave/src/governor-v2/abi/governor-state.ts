import { Interface } from 'ethers';

export const GOVERNOR_V2_STATE_INTERFACE = new Interface([
  'function getProposalState(uint256 proposalId) view returns (uint8)',
  'function getProposalById(uint256 proposalId) view returns (tuple(uint256 id, address creator, address executor, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, bool[] withDelegatecalls, uint256 startBlock, uint256 endBlock, uint256 executionTime, uint256 forVotes, uint256 againstVotes, bool executed, bool canceled, address strategy, bytes32 ipfsHash) proposal)',
]);

export const EXECUTOR_GRACE_PERIOD_INTERFACE = new Interface([
  'function GRACE_PERIOD() view returns (uint256)',
]);

export class AaveGovernorV2StateDecodeError extends Error {
  constructor(
    message: string,
    public readonly causeValue: unknown,
  ) {
    super(message);
    this.name = 'AaveGovernorV2StateDecodeError';
  }
}

// NOTE: `getProposalState` is intentionally NOT called. It — and the `isProposalPassed` it invokes —
// revert for every historical proposal on the mainnet AaveGovernanceV2 contract, because the tally
// is recomputed through the governance strategy's historical voting-power snapshot, which the v2→v3
// migration broke. The reconciler derives state from `getProposalById` instead (see
// `deriveAaveV2State`). The ABI fragment stays in the interface for reference and selector checks.

export function encodeGetProposalByIdCall(sourceId: string): string {
  return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionData('getProposalById', [BigInt(sourceId)]);
}

export interface V2ProposalSummary {
  executor: string;
  executionTime: bigint;
  startBlock: bigint;
  endBlock: bigint;
  executed: boolean;
  canceled: boolean;
}

export function decodeGetProposalByIdResult(data: string): V2ProposalSummary {
  try {
    const [proposal] = GOVERNOR_V2_STATE_INTERFACE.decodeFunctionResult('getProposalById', data);
    return {
      executor: (proposal.executor as string).toLowerCase(),
      executionTime: proposal.executionTime as bigint,
      startBlock: proposal.startBlock as bigint,
      endBlock: proposal.endBlock as bigint,
      executed: proposal.executed as boolean,
      canceled: proposal.canceled as boolean,
    };
  } catch (err) {
    throw new AaveGovernorV2StateDecodeError(
      'failed to decode governor v2 getProposalById() result',
      err,
    );
  }
}

/**
 * The state the reconciler derives for a stale v2 proposal, from `getProposalById` fields alone.
 *
 * `getProposalState` is unusable against live mainnet: it — and the `isProposalPassed` it calls —
 * revert for EVERY historical proposal (verified against an executed one too), because the vote
 * tally is recomputed through the governance strategy's historical voting-power snapshot, which the
 * v2→v3 migration broke. `getProposalById` returns the raw struct and does not touch the strategy,
 * so it still works.
 *
 * This mirrors `AaveGovernanceV2.getProposalState` minus the one reverting branch — the
 * `isProposalPassed` check that decides Failed-vs-Succeeded for a concluded, never-queued proposal.
 * Dropping it is safe for reconciliation: a proposal whose voting ended and that was never queued
 * (`executionTime == 0`) did not advance to execution and is terminally Defeated. Had it passed it
 * would have been queued years ago; `executionTime == 0` proves it was not. `expired` covers the
 * inverse — queued but never executed within the grace window.
 */
export type V2DerivedState =
  | { kind: 'terminal'; state: 'canceled' | 'executed' | 'defeated' }
  | { kind: 'awaiting_execution'; executionTime: bigint; executor: string } // queued or expired — needs grace
  | { kind: 'not_stale'; state: 'pending' | 'active' };

export function deriveAaveV2State(
  summary: V2ProposalSummary,
  confirmedHead: bigint,
): V2DerivedState {
  if (summary.canceled) return { kind: 'terminal', state: 'canceled' };
  if (summary.executed) return { kind: 'terminal', state: 'executed' };
  if (confirmedHead <= summary.startBlock) return { kind: 'not_stale', state: 'pending' };
  if (confirmedHead <= summary.endBlock) return { kind: 'not_stale', state: 'active' };
  // Voting has concluded at the confirmed head.
  if (summary.executionTime === 0n) return { kind: 'terminal', state: 'defeated' };
  return {
    kind: 'awaiting_execution',
    executionTime: summary.executionTime,
    executor: summary.executor,
  };
}

export function encodeGracePeriodCall(): string {
  return EXECUTOR_GRACE_PERIOD_INTERFACE.encodeFunctionData('GRACE_PERIOD');
}

export function decodeGracePeriodResult(data: string): number {
  try {
    const [gracePeriod] = EXECUTOR_GRACE_PERIOD_INTERFACE.decodeFunctionResult(
      'GRACE_PERIOD',
      data,
    );
    return Number(gracePeriod);
  } catch (err) {
    throw new AaveGovernorV2StateDecodeError(
      'failed to decode executor GRACE_PERIOD() result',
      err,
    );
  }
}
