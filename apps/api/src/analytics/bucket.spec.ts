import { estimateBucketCount } from './bucket';

describe('estimateBucketCount', () => {
  it('counts daily buckets inclusively', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-03T00:00:00.000Z');
    expect(estimateBucketCount(from, to, 'daily')).toBe(3);
  });

  it('counts monthly buckets across years', () => {
    const from = new Date('2025-11-01T00:00:00.000Z');
    const to = new Date('2026-02-01T00:00:00.000Z');
    expect(estimateBucketCount(from, to, 'monthly')).toBe(4);
  });
});
