import type { SafeApiKey } from '@libs/db';
import { UsageController } from './usage.controller';
import type { PeekResult } from '../rate-limit/rate-limiter.service';

const USER = { id: 'user-1' } as never;

function fakeKey(overrides: Partial<SafeApiKey> = {}): SafeApiKey {
  return {
    id: 'k1',
    user_id: 'user-1',
    prefix: 'kv_live_',
    last_four: 'abcd',
    tier: 'authenticated_free',
    label: null,
    created_at: new Date('2026-08-01'),
    last_used_at: null,
    revoked_at: null,
    expires_at: null,
    ...overrides,
  };
}

const PEEK_RESULT: PeekResult = {
  minute: { used: 5, limit: 60, resetSeconds: 42 },
  day: { used: 200, limit: 10_000, resetSeconds: 3600 },
};

describe('UsageController', () => {
  it('returns buckets and key usage for active non-dashboard keys', async () => {
    const keys = {
      listByUser: vi
        .fn()
        .mockResolvedValue([
          fakeKey({ id: 'k1', label: 'My Key' }),
          fakeKey({ id: 'k2', tier: 'dashboard' }),
          fakeKey({ id: 'k3', revoked_at: new Date() }),
        ]),
    };
    const rateLimiter = { peek: vi.fn().mockResolvedValue(PEEK_RESULT) };
    const recorder = {
      getDailyUsage: vi.fn().mockResolvedValue(new Map([['k1', { '2026-08-27': 10 }]])),
    };
    const controller = new UsageController(keys as never, rateLimiter as never, recorder as never);

    const result = await controller.getUsage(USER);

    expect(result.buckets).toHaveLength(30);
    expect(result.buckets[29]).toBe(new Date().toISOString().slice(0, 10));
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0]!.id).toBe('k1');
    expect(result.keys[0]!.label).toBe('My Key');
    expect(result.keys[0]!.rate_limit).toEqual(PEEK_RESULT);
    expect(result.keys[0]!.daily).toHaveLength(30);

    expect(keys.listByUser).toHaveBeenCalledWith('user-1');
    expect(rateLimiter.peek).toHaveBeenCalledWith('apikey:k1', 'authenticated_free');
    expect(recorder.getDailyUsage).toHaveBeenCalledWith(['k1'], 30);
  });

  it('returns empty keys array when user has no keys', async () => {
    const keys = { listByUser: vi.fn().mockResolvedValue([]) };
    const rateLimiter = { peek: vi.fn() };
    const recorder = { getDailyUsage: vi.fn().mockResolvedValue(new Map()) };
    const controller = new UsageController(keys as never, rateLimiter as never, recorder as never);

    const result = await controller.getUsage(USER);

    expect(result.buckets).toHaveLength(30);
    expect(result.keys).toEqual([]);
    expect(rateLimiter.peek).not.toHaveBeenCalled();
  });

  it('aligns daily counts to buckets with zeros for missing dates', async () => {
    const keys = { listByUser: vi.fn().mockResolvedValue([fakeKey()]) };
    const rateLimiter = { peek: vi.fn().mockResolvedValue(PEEK_RESULT) };
    const recorder = { getDailyUsage: vi.fn().mockResolvedValue(new Map([['k1', {}]])) };
    const controller = new UsageController(keys as never, rateLimiter as never, recorder as never);

    const result = await controller.getUsage(USER);

    expect(result.keys[0]!.daily.every((v) => v === 0)).toBe(true);
  });

  it('falls back to free tier limits when peek returns null', async () => {
    const keys = {
      listByUser: vi.fn().mockResolvedValue([fakeKey({ tier: 'mystery' as never })]),
    };
    const rateLimiter = { peek: vi.fn() };
    const recorder = { getDailyUsage: vi.fn().mockResolvedValue(new Map([['k1', {}]])) };
    const controller = new UsageController(keys as never, rateLimiter as never, recorder as never);

    const result = await controller.getUsage(USER);

    expect(result.keys[0]!.rate_limit.minute.limit).toBe(60);
    expect(result.keys[0]!.rate_limit.day.limit).toBe(10_000);
  });
});
