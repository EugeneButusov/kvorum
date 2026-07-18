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

export function encodeGetProposalStateCall(sourceId: string): string {
  return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionData('getProposalState', [BigInt(sourceId)]);
}

export function decodeProposalStateResult(data: string): number {
  try {
    const [stateCode] = GOVERNOR_V2_STATE_INTERFACE.decodeFunctionResult('getProposalState', data);
    return Number(stateCode);
  } catch (err) {
    throw new AaveGovernorV2StateDecodeError(
      'failed to decode governor v2 getProposalState() result',
      err,
    );
  }
}

/** AaveGovernanceV2 ProposalState enum values the reconciler acts on. */
export const AAVE_V2_STATE_FAILED = 3;
export const AAVE_V2_STATE_SUCCEEDED = 4;

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
 * Classifies a stale v2 proposal from the `getProposalById` struct, and says how the reconciler
 * should finish resolving it. The mechanical facts (`canceled`, `executed`, `executionTime`) come
 * straight from the struct; the two states with no on-chain event — the vote outcome and expiry —
 * are handed back for a follow-up call.
 *
 * Why not just call `getProposalState`? At the confirmed head it reverts for EVERY historical
 * proposal (verified on an executed one too): it recomputes the tally through the governance
 * strategy's voting-power snapshot, and the v2→v3 migration broke that path. It still works when
 * called at a block near the proposal's own conclusion — see `needs_outcome`.
 */
export type V2DerivedState =
  | { kind: 'terminal'; state: 'canceled' | 'executed' }
  // Voting concluded, never queued (executionTime == 0). The Failed-vs-Succeeded verdict needs the
  // quorum math, which `getProposalState` still does correctly when called at `endBlock`.
  | { kind: 'needs_outcome'; endBlock: bigint }
  // Queued (executionTime > 0) but no execute/cancel: expired vs still-queued, decided by grace.
  | { kind: 'awaiting_execution'; executionTime: bigint; executor: string }
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
  if (summary.executionTime === 0n) return { kind: 'needs_outcome', endBlock: summary.endBlock };
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
