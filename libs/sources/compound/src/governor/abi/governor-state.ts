import type { ProposalState } from '@libs/db';
import { Interface } from 'ethers';

export const GOVERNOR_STATE_INTERFACE = new Interface([
  'function state(uint256) view returns (uint8)',
  'function timelock() view returns (address)',
]);

export const TIMELOCK_INTERFACE = new Interface(['function GRACE_PERIOD() view returns (uint256)']);

export class GovernorStateDecodeError extends Error {
  constructor(
    message: string,
    public readonly causeValue: unknown,
  ) {
    super(message);
    this.name = 'GovernorStateDecodeError';
  }
}

export function encodeStateCall(sourceId: string): string {
  return GOVERNOR_STATE_INTERFACE.encodeFunctionData('state', [BigInt(sourceId)]);
}

export function decodeStateResult(data: string): number {
  try {
    const [stateCode] = GOVERNOR_STATE_INTERFACE.decodeFunctionResult('state', data);
    return Number(stateCode);
  } catch (err) {
    throw new GovernorStateDecodeError('failed to decode governor state() result', err);
  }
}

export function encodeTimelockCall(): string {
  return GOVERNOR_STATE_INTERFACE.encodeFunctionData('timelock');
}

export function decodeTimelockResult(data: string): string {
  try {
    const [address] = GOVERNOR_STATE_INTERFACE.decodeFunctionResult('timelock', data);
    return (address as string).toLowerCase();
  } catch (err) {
    throw new GovernorStateDecodeError('failed to decode governor timelock() result', err);
  }
}

export function encodeGracePeriodCall(): string {
  return TIMELOCK_INTERFACE.encodeFunctionData('GRACE_PERIOD');
}

export function decodeGracePeriodResult(data: string): number {
  try {
    const [seconds] = TIMELOCK_INTERFACE.decodeFunctionResult('GRACE_PERIOD', data);
    return Number(seconds);
  } catch (err) {
    throw new GovernorStateDecodeError('failed to decode timelock GRACE_PERIOD() result', err);
  }
}

export function mapGovernorStateCode(code: number): ProposalState {
  switch (code) {
    case 0:
      return 'pending';
    case 1:
      return 'active';
    case 2:
      return 'canceled';
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
      throw new GovernorStateDecodeError(`unknown governor state code: ${code}`, code);
  }
}
