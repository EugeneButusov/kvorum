import { Interface } from 'ethers';

const AAVE_TOKEN_V3_INTERFACE = new Interface([
  'function getPowerCurrent(address user, uint8 delegationType) view returns (uint256)',
]);

export class AaveTokenPowerDecodeError extends Error {
  constructor(
    message: string,
    public readonly causeValue: unknown,
  ) {
    super(message);
    this.name = 'AaveTokenPowerDecodeError';
  }
}

export function encodeGetPowerCurrentCall(user: string, delegationType: number): string {
  return AAVE_TOKEN_V3_INTERFACE.encodeFunctionData('getPowerCurrent', [user, delegationType]);
}

export function decodeGetPowerCurrentResult(data: string): bigint {
  try {
    const [power] = AAVE_TOKEN_V3_INTERFACE.decodeFunctionResult('getPowerCurrent', data);
    return power as bigint;
  } catch (err) {
    throw new AaveTokenPowerDecodeError('failed to decode getPowerCurrent() result', err);
  }
}
