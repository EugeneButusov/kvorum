import { Interface } from 'ethers';
import type { ProposalState } from '@libs/db';

export const GOVERNANCE_STATE_INTERFACE = new Interface([
  'function getProposalState(uint256) view returns (uint8)',
  'function PROPOSAL_EXPIRATION_TIME() view returns (uint256)',
]);

export class AaveGovernanceStateDecodeError extends Error {
  constructor(
    message: string,
    public readonly causeValue: unknown,
  ) {
    super(message);
    this.name = 'AaveGovernanceStateDecodeError';
  }
}

export function encodeGetProposalStateCall(sourceId: string): string {
  return GOVERNANCE_STATE_INTERFACE.encodeFunctionData('getProposalState', [BigInt(sourceId)]);
}

export function decodeProposalStateResult(data: string): number {
  try {
    const [stateCode] = GOVERNANCE_STATE_INTERFACE.decodeFunctionResult('getProposalState', data);
    return Number(stateCode);
  } catch (err) {
    throw new AaveGovernanceStateDecodeError(
      'failed to decode governance getProposalState() result',
      err,
    );
  }
}

export function encodeExpirationTimeCall(): string {
  return GOVERNANCE_STATE_INTERFACE.encodeFunctionData('PROPOSAL_EXPIRATION_TIME');
}

export function decodeExpirationTimeResult(data: string): number {
  try {
    const [seconds] = GOVERNANCE_STATE_INTERFACE.decodeFunctionResult(
      'PROPOSAL_EXPIRATION_TIME',
      data,
    );
    return Number(seconds);
  } catch (err) {
    throw new AaveGovernanceStateDecodeError(
      'failed to decode governance PROPOSAL_EXPIRATION_TIME() result',
      err,
    );
  }
}

export function mapAaveStateCode(code: number): ProposalState {
  switch (code) {
    case 1:
      return 'pending';
    case 2:
      return 'active';
    case 3:
      return 'queued';
    case 4:
      return 'executed';
    case 5:
      return 'defeated';
    case 6:
      return 'canceled';
    case 7:
      return 'expired';
    case 0:
      throw new AaveGovernanceStateDecodeError('unexpected Aave governance Null state', code);
    default:
      throw new AaveGovernanceStateDecodeError(`unknown Aave governance state code: ${code}`, code);
  }
}
