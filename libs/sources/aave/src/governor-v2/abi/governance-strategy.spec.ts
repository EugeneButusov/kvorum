import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  decodeTotalVotingSupplyAtResult,
  encodeTotalVotingSupplyAtCall,
} from './governance-strategy';

const STRATEGY = new Interface([
  'function getTotalVotingSupplyAt(uint256 blockNumber) view returns (uint256)',
]);

describe('governance-strategy ABI helpers', () => {
  it('encodes with the known 4-byte selector', () => {
    const encoded = encodeTotalVotingSupplyAtCall(11_500_000n);
    expect(encoded.slice(0, 10)).toBe(STRATEGY.getFunction('getTotalVotingSupplyAt')!.selector);
  });

  it('round-trips a known value', () => {
    const supply = 16_000_000n * 10n ** 18n;
    const encoded = STRATEGY.encodeFunctionResult('getTotalVotingSupplyAt', [supply]);
    expect(decodeTotalVotingSupplyAtResult(encoded)).toBe(supply);
  });
});
