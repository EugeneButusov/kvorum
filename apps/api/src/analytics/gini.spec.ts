import { computeGini } from './gini';

describe('computeGini', () => {
  it('returns 0 for empty and singleton inputs', () => {
    expect(computeGini([])).toBe(0);
    expect(computeGini([10n])).toBe(0);
  });

  it('returns 0 for equal distribution', () => {
    expect(computeGini([10n, 10n, 10n, 10n])).toBe(0);
  });

  it('matches known closed-form values', () => {
    expect(computeGini([0n, 0n, 0n, 40n])).toBeCloseTo(0.75, 12);
    expect(computeGini([1n, 2n, 3n, 4n])).toBeCloseTo(0.25, 12);
  });

  it('preserves precision with 18-decimal token amounts', () => {
    const unit = 10n ** 18n;
    // equal amounts → Gini = 0
    expect(computeGini([unit, unit])).toBe(0);
    // 1:3 ratio: G = (2*(1·1 + 2·3) − 3·(1+3)) / (2·(1+3)) = 2/8 = 0.25
    expect(computeGini([unit, 3n * unit])).toBeCloseTo(0.25, 12);
  });
});
