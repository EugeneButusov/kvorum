import { Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { parseRateLimitConfigFromEnv } from './rate-limit.config';
import { RateLimitInterceptor } from './rate-limit.interceptor';
import type { RateLimitResult } from './rate-limiter.service';
import { RateLimiterService } from './rate-limiter.service';
import { createRateLimitRedis, type SlidingWindowRedis } from './redis.client';

const RATE_LIMIT_CONFIG = Symbol('RATE_LIMIT_CONFIG');
const RATE_LIMIT_REDIS = Symbol('RATE_LIMIT_REDIS');

const TEST_RATE_LIMIT_RESULT: RateLimitResult = {
  allowed: true,
  limit: Number.MAX_SAFE_INTEGER,
  remaining: Number.MAX_SAFE_INTEGER,
  resetSeconds: 0,
  retryAfterSeconds: 0,
  bindingWindow: 'minute',
};

class RedisLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(private readonly redis: SlidingWindowRedis) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env['NODE_ENV'] === 'test') return;
    await this.redis.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    if (process.env['NODE_ENV'] === 'test') return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
      return;
    }
    this.redis.disconnect();
  }
}

@Module({
  providers: [
    {
      provide: RATE_LIMIT_CONFIG,
      useFactory: () => parseRateLimitConfigFromEnv(process.env),
    },
    {
      provide: RATE_LIMIT_REDIS,
      useFactory: (config: ReturnType<typeof parseRateLimitConfigFromEnv>) =>
        createRateLimitRedis(config),
      inject: [RATE_LIMIT_CONFIG],
    },
    {
      provide: RateLimiterService,
      useFactory: (redis: SlidingWindowRedis) => {
        if (process.env['NODE_ENV'] === 'test') {
          return {
            consume: async () => TEST_RATE_LIMIT_RESULT,
          } as unknown as RateLimiterService;
        }
        return new RateLimiterService(redis);
      },
      inject: [RATE_LIMIT_REDIS],
    },
    {
      provide: RateLimitInterceptor,
      useFactory: (rateLimiterService: RateLimiterService) =>
        new RateLimitInterceptor(rateLimiterService),
      inject: [RateLimiterService],
    },
    {
      provide: APP_INTERCEPTOR,
      useExisting: RateLimitInterceptor,
    },
    {
      provide: RedisLifecycle,
      useFactory: (redis: SlidingWindowRedis) => new RedisLifecycle(redis),
      inject: [RATE_LIMIT_REDIS],
    },
  ],
})
export class RateLimitModule {}
