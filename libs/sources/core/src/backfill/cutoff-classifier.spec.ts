import { describe, it, expect } from 'vitest';
import { makeCutoffClassifier } from './cutoff-classifier';

describe('makeCutoffClassifier', () => {
  const cutoff = 20_000_000n;
  const classify = makeCutoffClassifier(cutoff);

  it('#1 — block below cutoff ⇒ confirmed', () => {
    expect(classify(19_999_999n)).toBe('confirmed');
  });

  it('#2 — block exactly at cutoff ⇒ confirmed (<=)', () => {
    expect(classify(20_000_000n)).toBe('confirmed');
  });

  it('#3 — block above cutoff ⇒ pending', () => {
    expect(classify(20_000_001n)).toBe('pending');
  });

  it('#4 — cutoff = 0n: only block 0 is confirmed', () => {
    const c = makeCutoffClassifier(0n);
    expect(c(0n)).toBe('confirmed');
    expect(c(1n)).toBe('pending');
  });
});
