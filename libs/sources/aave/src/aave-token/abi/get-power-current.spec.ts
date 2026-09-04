import { AbiCoder, Interface } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  AaveTokenPowerDecodeError,
  decodeGetPowerCurrentResult,
  encodeGetPowerCurrentCall,
} from './get-power-current';

const DELEGATE_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

describe('getPowerCurrent ABI helpers', () => {
  it('encodes the correct function selector and arguments', () => {
    const calldata = encodeGetPowerCurrentCall(DELEGATE_ADDRESS, 0);
    const iface = new Interface([
      'function getPowerCurrent(address user, uint8 delegationType) view returns (uint256)',
    ]);
    const parsed = iface.parseTransaction({ data: calldata });
    expect(parsed?.name).toBe('getPowerCurrent');
    expect(parsed?.args[0].toLowerCase()).toBe(DELEGATE_ADDRESS.toLowerCase());
    expect(Number(parsed?.args[1])).toBe(0);
  });

  it('round-trips an encoded value through decode', () => {
    const power = 123456789012345678901234n;
    const encoded = AbiCoder.defaultAbiCoder().encode(['uint256'], [power]);
    expect(decodeGetPowerCurrentResult(encoded)).toBe(power);
  });

  it('decodes zero power', () => {
    const encoded = AbiCoder.defaultAbiCoder().encode(['uint256'], [0n]);
    expect(decodeGetPowerCurrentResult(encoded)).toBe(0n);
  });

  it('throws AaveTokenPowerDecodeError on invalid data', () => {
    expect(() => decodeGetPowerCurrentResult('0xdeadbeef')).toThrow(AaveTokenPowerDecodeError);
  });

  it('encodes delegationType=1 (PROPOSITION) correctly', () => {
    const calldata = encodeGetPowerCurrentCall(DELEGATE_ADDRESS, 1);
    const iface = new Interface([
      'function getPowerCurrent(address user, uint8 delegationType) view returns (uint256)',
    ]);
    const parsed = iface.parseTransaction({ data: calldata });
    expect(Number(parsed?.args[1])).toBe(1);
  });
});
