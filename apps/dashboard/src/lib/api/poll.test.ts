import { parseQuota, tallyIntervalMs } from './poll';

describe('tallyIntervalMs — ADR-035 quota tiers', () => {
  it.each([
    [null, 10_000], // no quota headers → base cadence, never paused
    [1.0, 10_000],
    [0.25, 10_000],
    [0.24, 20_000],
    [0.1, 20_000],
    [0.09, false], // < 10% → paused
    [0, false],
  ] as const)('fraction %s → %s', (fraction, expected) => {
    expect(tallyIntervalMs(fraction)).toBe(expected);
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
