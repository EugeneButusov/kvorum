import { RateLimiterService, RedisUnavailableError } from './rate-limiter.service';

type SlidingWindowFn = (
  ...args: Array<string | number>
) => Promise<[number, number, number, number, number, string]>;

describe('RateLimiterService', () => {
  it('maps script response to RateLimitResult', async () => {
    const slidingWindow: SlidingWindowFn = vi.fn(async () => [1, 60, 59, 60, 0, 'minute']);

    const service = new RateLimiterService({ slidingWindow } as never);
    const result = await service.consume('apikey:k1', 'authenticated_free', 1_700_000_000_000);

    expect(slidingWindow).toHaveBeenCalledWith(
      'rl:apikey:k1:m',
      'rl:apikey:k1:d',
      1_700_000_000_000,
      60,
      10_000,
      expect.any(String),
    );
    expect(result).toEqual({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetSeconds: 60,
      retryAfterSeconds: 0,
      bindingWindow: 'minute',
    });
  });

  it('throws RedisUnavailableError when redis command fails', async () => {
    const slidingWindow: SlidingWindowFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    const service = new RateLimiterService({ slidingWindow } as never);
    await expect(service.consume('apikey:k1', 'authenticated_free')).rejects.toBeInstanceOf(
      RedisUnavailableError,
    );
  });
});
