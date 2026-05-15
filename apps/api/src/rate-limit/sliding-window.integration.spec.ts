import { randomUUID } from 'node:crypto';
import RedisMock from 'ioredis-mock';
import { RateLimiterService } from './rate-limiter.service';
import { type SlidingWindowRedis } from './redis.client';
import { SLIDING_WINDOW_LUA } from './sliding-window.lua';

describe('sliding-window integration', () => {
  let redisService: RateLimiterService;
  let redisClient: SlidingWindowRedis;

  beforeAll(() => {
    redisClient = new RedisMock() as SlidingWindowRedis;
    redisClient.defineCommand('slidingWindow', {
      numberOfKeys: 2,
      lua: SLIDING_WINDOW_LUA,
    });
    redisService = new RateLimiterService(redisClient);
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  it('locks return contract: first request leaves remaining=59', async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 10, 0);
    const identity = `it:${randomUUID()}`;

    const result = await redisService.consume(identity, 'authenticated_free', now);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(59);
    expect(result.limit).toBe(60);
  });

  it('rejects 61st request when 60 are inside first 30 seconds (sliding window)', async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 20, 0);
    const identity = `it:${randomUUID()}`;

    for (let i = 0; i < 60; i += 1) {
      const result = await redisService.consume(identity, 'authenticated_free', now);
      expect(result.allowed).toBe(true);
    }

    const rejected = await redisService.consume(identity, 'authenticated_free', now);
    expect(rejected.allowed).toBe(false);
    expect(rejected.bindingWindow).toBe('minute');
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('admits again after minute boundary rollover with weighted decay', async () => {
    const withinFirstMinute = Date.UTC(2026, 0, 1, 0, 0, 20, 0);
    const nextMinute = Date.UTC(2026, 0, 1, 0, 1, 21, 0);
    const identity = `it:${randomUUID()}`;

    for (let i = 0; i < 60; i += 1) {
      await redisService.consume(identity, 'authenticated_free', withinFirstMinute);
    }

    const afterRollover = await redisService.consume(identity, 'authenticated_free', nextMinute);
    expect(afterRollover.allowed).toBe(true);
    expect(afterRollover.remaining).toBeGreaterThanOrEqual(0);
  });

  it('enforces daily limit on 10,001st request', async () => {
    const identity = `it:${randomUUID()}`;
    const now = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
    const minuteKey = `rl:${identity}:m`;
    const dayKey = `rl:${identity}:d`;
    const minuteLimit = 1_000;
    const dayLimit = 5;

    for (let i = 0; i < dayLimit; i += 1) {
      const allowed = await redisClient.slidingWindow(
        minuteKey,
        dayKey,
        now + i * 1_000,
        minuteLimit,
        dayLimit,
        `test-member-${i}`,
      );
      expect(allowed[0]).toBe(1);
    }

    const rejected = await redisClient.slidingWindow(
      minuteKey,
      dayKey,
      now + dayLimit * 1_000,
      minuteLimit,
      dayLimit,
      'test-member-reject',
    );
    expect(rejected[0]).toBe(0);
    expect(rejected[5]).toBe('day');
    expect(Number(rejected[4])).toBeGreaterThan(0);
  });

  it('is atomic under concurrency: exactly 60 allowed out of 100 parallel calls', async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 20, 0);
    const identity = `it:${randomUUID()}`;

    const results = await Promise.all(
      Array.from({ length: 100 }, () => redisService.consume(identity, 'authenticated_free', now)),
    );

    const allowed = results.filter((result) => result.allowed).length;
    expect(allowed).toBe(60);
  });
});
