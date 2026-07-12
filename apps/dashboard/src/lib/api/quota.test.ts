import { parseQuota, quotaInterval } from './quota';

describe('quotaInterval — ADR-035 adaptive tiers', () => {
  it.each([
    [null, 10_000], // no quota headers → base cadence, never paused
    [1.0, 10_000],
    [0.25, 10_000],
    [0.24, 20_000], // 10–25% → 2× base
    [0.1, 20_000],
    [0.09, false], // < 10% → paused
    [0, false],
  ] as const)('tally base, fraction %s → %s', (fraction, expected) => {
    expect(quotaInterval(10_000, fraction)).toBe(expected);
  });

  it('applies the same tiers to the 30s feed base (2× at 10–25%)', () => {
    expect(quotaInterval(30_000, 0.5)).toBe(30_000);
    expect(quotaInterval(30_000, 0.2)).toBe(60_000);
    expect(quotaInterval(30_000, 0.05)).toBe(false);
  });
});

describe('parseQuota', () => {
  it('computes the remaining fraction from RateLimit-* headers', () => {
    const headers = new Headers({ 'ratelimit-remaining': '15', 'ratelimit-limit': '60' });
    expect(parseQuota(headers).fraction).toBe(0.25);
  });

  it('clamps to [0,1]', () => {
    const over = new Headers({ 'ratelimit-remaining': '90', 'ratelimit-limit': '60' });
    expect(parseQuota(over).fraction).toBe(1);
  });

  it('returns null when the headers are absent or unusable', () => {
    expect(parseQuota(new Headers()).fraction).toBeNull();
    expect(
      parseQuota(new Headers({ 'ratelimit-remaining': '5', 'ratelimit-limit': '0' })).fraction,
    ).toBeNull();
  });
});
