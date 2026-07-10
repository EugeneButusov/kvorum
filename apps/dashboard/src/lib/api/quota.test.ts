import {
  adaptiveRefetchInterval,
  pollInterval,
  readQuotaFromHeaders,
  setQuota,
  type Quota,
} from './quota';

const q = (remaining: number, limit = 100): Quota => ({ limit, remaining, resetSeconds: 30 });

describe('pollInterval (ADR-035 tiers)', () => {
  it.each([
    ['tally', q(100), 10_000],
    ['tally', q(30), 10_000], // 30% ≥ 25% → base
    ['tally', q(20), 20_000], // 20% in 10–25% → 2× base
    ['tally', q(5), false], // 5% < 10% → paused
    ['feed', q(100), 30_000],
    ['feed', q(20), 60_000],
    ['feed', q(5), false],
  ] as const)('%s at the given quota', (kind, quota, expected) => {
    expect(pollInterval(kind, quota)).toBe(expected);
  });

  it('is optimistic when quota is unknown', () => {
    expect(pollInterval('tally', null)).toBe(10_000);
    expect(pollInterval('feed', null)).toBe(30_000);
  });
});

describe('readQuotaFromHeaders', () => {
  it('parses the RateLimit-* headers', () => {
    const headers = new Headers({
      'RateLimit-Limit': '60',
      'RateLimit-Remaining': '42',
      'RateLimit-Reset': '30',
    });
    expect(readQuotaFromHeaders(headers)).toEqual({ limit: 60, remaining: 42, resetSeconds: 30 });
  });

  it('returns null when the headers are absent', () => {
    expect(readQuotaFromHeaders(new Headers())).toBeNull();
  });
});

describe('adaptiveRefetchInterval', () => {
  it('reflects the live quota store each call', () => {
    const interval = adaptiveRefetchInterval('tally');
    setQuota(q(5));
    expect(interval()).toBe(false);
    setQuota(q(80));
    expect(interval()).toBe(10_000);
    setQuota(null);
  });
});
