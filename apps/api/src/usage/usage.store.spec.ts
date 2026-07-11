import type Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { endpointFamily, UsageStore } from './usage.store';

function makeStore(): UsageStore {
  return new UsageStore(new RedisMock() as unknown as Redis);
}

describe('UsageStore', () => {
  // ioredis-mock shares its datastore across instances; clear it between cases for isolation.
  beforeEach(async () => {
    await new RedisMock().flushall();
  });

  it('records per-family + month totals and reports the 30-day breakdown', async () => {
    const store = makeStore();
    await store.record('k1', 'daos');
    await store.record('k1', 'daos');
    await store.record('k1', 'proposals');

    expect(await store.currentMonthTotal('k1')).toBe(3);
    expect(await store.last30DaysByFamily('k1')).toEqual({ daos: 2, proposals: 1 });
  });

  it('only counts days within the trailing 30-day window', async () => {
    const store = makeStore();
    const now = new Date('2026-02-15T00:00:00Z');
    const old = new Date('2026-01-01T00:00:00Z'); // >30 days before `now`

    await store.record('k1', 'votes', old);
    await store.record('k1', 'votes', now);

    // The old day's counter exists but falls outside the 30-day scan from `now`.
    expect(await store.last30DaysByFamily('k1', now)).toEqual({ votes: 1 });
  });

  it('reports zero for an unused key', async () => {
    const store = makeStore();
    expect(await store.currentMonthTotal('nope')).toBe(0);
    expect(await store.last30DaysByFamily('nope')).toEqual({});
  });
});

describe('endpointFamily', () => {
  it('extracts the first path segment after /v1/', () => {
    expect(endpointFamily('/v1/daos/:slug')).toBe('daos');
    expect(endpointFamily('/v1/actors/:address/votes')).toBe('actors');
    expect(endpointFamily('v1/proposals')).toBe('proposals');
  });

  it('falls back to "other" for unrecognised paths', () => {
    expect(endpointFamily('/health')).toBe('other');
    expect(endpointFamily('')).toBe('other');
  });
});
