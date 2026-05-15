import { randomUUID } from 'node:crypto';
import { parseRateLimitConfigFromEnv } from './rate-limit.config';
import { RateLimiterService } from './rate-limiter.service';
import { createRateLimitRedis } from './redis.client';

const describeIf = process.env.REDIS_URL ? describe : describe.skip;

describeIf('sliding-window integration', () => {
  let redisService: RateLimiterService;
  let redisClient: ReturnType<typeof createRateLimitRedis>;

  beforeAll(() => {
    const config = parseRateLimitConfigFromEnv(process.env);
    redisClient = createRateLimitRedis(config);
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
    const nextMinute = Date.UTC(2026, 0, 1, 0, 1, 10, 0);
    const identity = `it:${randomUUID()}`;

    for (let i = 0; i < 60; i += 1) {
      await redisService.consume(identity, 'authenticated_free', withinFirstMinute);
    }

    const afterRollover = await redisService.consume(identity, 'authenticated_free', nextMinute);
    expect(afterRollover.allowed).toBe(true);
    expect(afterRollover.remaining).toBeGreaterThanOrEqual(0);
  });

  it('enforces daily limit on 10,001st request', async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0, 0);
    const identity = `it:${randomUUID()}`;

    for (let i = 0; i < 10_000; i += 1) {
      const result = await redisService.consume(identity, 'authenticated_free', now + i * 60_100);
      expect(result.allowed).toBe(true);
    }

    const rejected = await redisService.consume(
      identity,
      'authenticated_free',
      now + 10_000 * 60_100,
    );
    expect(rejected.allowed).toBe(false);
    expect(rejected.bindingWindow).toBe('day');
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
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
