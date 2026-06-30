import { describe, it, expect } from 'vitest';
import { networkToChainId, roundVp } from './voting-power';

describe('roundVp', () => {
  it('rounds decimal reported power to an integer string', () => {
    expect(roundVp(1234.5678)).toBe('1235');
    expect(roundVp('1234.4')).toBe('1234');
    expect(roundVp(0)).toBe('0');
  });

  it('floors null/negative/non-finite to 0', () => {
    expect(roundVp(null)).toBe('0');
    expect(roundVp(undefined)).toBe('0');
    expect(roundVp(-5)).toBe('0');
    expect(roundVp('not a number')).toBe('0');
  });

  it('handles large power without exponential notation', () => {
    expect(roundVp(1e21)).toBe('1000000000000000000000');
  });
});

describe('networkToChainId', () => {
  it('maps a decimal network to hex', () => {
    expect(networkToChainId('1')).toBe('0x1');
    expect(networkToChainId('137')).toBe('0x89');
  });

  it('falls back to mainnet for missing/invalid network', () => {
    expect(networkToChainId(null)).toBe('0x1');
    expect(networkToChainId('')).toBe('0x1');
    expect(networkToChainId('abc')).toBe('0x1');
  });
});
