import { describe, expect, it } from 'vitest';
import { normalizeWeights } from './weights';

describe('normalizeWeights', () => {
  it('normalizes an even split to 0.5 / 0.5', () => {
    expect(normalizeWeights([1n, 1n])).toEqual(['0.5', '0.5']);
  });

  it('normalizes thirds with the residue on the largest entry, summing to 1', () => {
    const w = normalizeWeights([1n, 1n, 1n]);
    expect(w).toHaveLength(3);
    // 1/3 each; residue (1) goes to the first (max ties → first).
    expect(w[0]).toBe('0.333333333333333334');
    expect(w[1]).toBe('0.333333333333333333');
    expect(w[2]).toBe('0.333333333333333333');
  });

  it('weights proportionally to ratios', () => {
    expect(normalizeWeights([3n, 1n])).toEqual(['0.75', '0.25']);
  });

  it('gives the rounding residue to the largest ratio', () => {
    // 2/(2+1)=0.6666…, 1/3=0.3333…; residue to index 0 (largest).
    const w = normalizeWeights([2n, 1n]);
    expect(w[0]).toBe('0.666666666666666667');
    expect(w[1]).toBe('0.333333333333333333');
  });

  it('returns "0" for every entry when the total is zero', () => {
    expect(normalizeWeights([0n, 0n])).toEqual(['0', '0']);
  });

  it('returns "1" for a single full-weight delegate', () => {
    expect(normalizeWeights([5n])).toEqual(['1']);
  });
});
