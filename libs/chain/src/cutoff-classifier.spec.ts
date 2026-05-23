import { describe, expect, it } from 'vitest';
import { makeCutoffClassifier } from './cutoff-classifier';

describe('makeCutoffClassifier', () => {
  it('returns confirmed at and below cutoff', () => {
    const classify = makeCutoffClassifier(100n);
    expect(classify(99n)).toBe('confirmed');
    expect(classify(100n)).toBe('confirmed');
  });

  it('returns pending above cutoff', () => {
    const classify = makeCutoffClassifier(100n);
    expect(classify(101n)).toBe('pending');
  });
});
