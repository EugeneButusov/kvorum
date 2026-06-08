import { Interface } from 'ethers';
import type { AavePayloadStatus } from '../../persistence/schema';

export const PAYLOAD_STATE_INTERFACE = new Interface([
  'function getPayloadById(uint40 payloadId) view returns (tuple(' +
    'address creator, uint8 maximumAccessLevelRequired, uint8 state, ' +
    'uint40 createdAt, uint40 queuedAt, uint40 executedAt, uint40 cancelledAt, ' +
    'uint40 expirationTime, uint40 delay, uint40 gracePeriod, ' +
    'tuple(address target, bool withDelegateCall, uint8 accessLevel, uint256 value, string signature, bytes callData)[] actions))',
]);

export class AavePayloadStateDecodeError extends Error {
  constructor(
    message: string,
    public readonly causeValue: unknown,
  ) {
    super(message);
    this.name = 'AavePayloadStateDecodeError';
  }
}

export function encodeGetPayloadStateCall(payloadId: string): string {
  return PAYLOAD_STATE_INTERFACE.encodeFunctionData('getPayloadById', [BigInt(payloadId)]);
}

export function decodePayloadStateResult(data: string): number {
  try {
    const [payload] = PAYLOAD_STATE_INTERFACE.decodeFunctionResult('getPayloadById', data);
    return Number(payload.state);
  } catch (err) {
    throw new AavePayloadStateDecodeError(
      'failed to decode payload controller getPayloadById() result',
      err,
    );
  }
}

export function mapPayloadStateCode(code: number): AavePayloadStatus | 'none' {
  switch (code) {
    case 0:
      return 'none';
    case 1:
      return 'created';
    case 2:
      return 'queued';
    case 3:
      return 'executed';
    case 4:
      return 'cancelled';
    case 5:
      return 'expired';
    default:
      throw new AavePayloadStateDecodeError(`unknown Aave payload state code: ${code}`, code);
  }
}
