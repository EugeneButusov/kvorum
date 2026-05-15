import { parseRateLimitConfigFromEnv } from './rate-limit.config';

describe('parseRateLimitConfigFromEnv', () => {
  it('uses default REDIS_URL when env is missing', () => {
    const config = parseRateLimitConfigFromEnv({});
    expect(config.redisUrl).toBe('redis://localhost:6379');
  });

  it('uses REDIS_URL from env when provided', () => {
    const config = parseRateLimitConfigFromEnv({ REDIS_URL: 'redis://127.0.0.1:6380/2' });
    expect(config.redisUrl).toBe('redis://127.0.0.1:6380/2');
  });

  it('throws when REDIS_URL is malformed', () => {
    expect(() => parseRateLimitConfigFromEnv({ REDIS_URL: 'not-a-url' })).toThrow();
  });
});
