import Redis from 'ioredis';
import { PEEK_WINDOW_LUA } from './peek-window.lua';
import type { RateLimitConfig } from './rate-limit.config';
import { SLIDING_WINDOW_LUA } from './sliding-window.lua';

interface SlidingWindowRedis extends Redis {
  slidingWindow: (
    ...args: Array<string | number>
  ) => Promise<[number, number, number, number, number, string]>;
  peekSlidingWindow: (
    minuteKey: string,
    dayKey: string,
    nowMs: number,
  ) => Promise<[number, number, number, number]>;
}

export function createRateLimitRedis(config: RateLimitConfig): SlidingWindowRedis {
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  }) as SlidingWindowRedis;

  redis.defineCommand('slidingWindow', {
    numberOfKeys: 2,
    lua: SLIDING_WINDOW_LUA,
  });

  redis.defineCommand('peekSlidingWindow', {
    numberOfKeys: 2,
    lua: PEEK_WINDOW_LUA,
  });

  redis.on('error', () => {
    // Intentionally attached to avoid unhandled ioredis errors during outages.
  });

  return redis;
}

export type { SlidingWindowRedis };
