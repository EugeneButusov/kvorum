import { Interface } from 'ethers';
import type { ProposalState } from '@libs/db';

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

export function encodeGetProposalByIdCall(sourceId: string): string {
  return GOVERNOR_V2_STATE_INTERFACE.encodeFunctionData('getProposalById', [BigInt(sourceId)]);
}

export interface V2ProposalSummary {
  executor: string;
  executionTime: bigint;
}

export function decodeGetProposalByIdResult(data: string): V2ProposalSummary {
  try {
    const [proposal] = GOVERNOR_V2_STATE_INTERFACE.decodeFunctionResult('getProposalById', data);
    return {
      executor: (proposal.executor as string).toLowerCase(),
      executionTime: proposal.executionTime as bigint,
    };
  } catch (err) {
    throw new AaveGovernorV2StateDecodeError(
      'failed to decode governor v2 getProposalById() result',
      err,
    );
  }
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

export function mapAaveV2StateCode(code: number): ProposalState {
  switch (code) {
    case 0:
      return 'pending';
    case 1:
      return 'canceled';
    case 2:
      return 'active';
    case 3:
      return 'defeated';
    case 4:
      return 'succeeded';
    case 5:
      return 'queued';
    case 6:
      return 'expired';
    case 7:
      return 'executed';
    default:
      throw new AaveGovernorV2StateDecodeError(
        `unknown Aave governor v2 state code: ${code}`,
        code,
      );
  }
}
