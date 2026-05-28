import { Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { parseRateLimitConfigFromEnv } from './rate-limit.config';
import { RateLimitInterceptor } from './rate-limit.interceptor';
import {
  RateLimiterService,
  RedisRateLimiterService,
  TestRateLimiterService,
  type RateLimiter,
} from './rate-limiter.service';
import { RATE_LIMITER } from './rate-limiter.token';
import { createRateLimitRedis, type SlidingWindowRedis } from './redis.client';

const RATE_LIMIT_CONFIG = Symbol('RATE_LIMIT_CONFIG');
const RATE_LIMIT_REDIS = Symbol('RATE_LIMIT_REDIS');

class RedisLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(private readonly redis: SlidingWindowRedis) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.redis.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      return;
    } finally {
      this.redis.disconnect();
    }
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
      useFactory: (config: ReturnType<typeof parseRateLimitConfigFromEnv>) => {
        const isTest = process.env['NODE_ENV'] === 'test';
        if (isTest) return createNoopRateLimitRedis();
        return createRateLimitRedis(config);
      },
      inject: [RATE_LIMIT_CONFIG],
    },
    {
      provide: RateLimiterService,
      useFactory: (redis: SlidingWindowRedis) => {
        const isTest = process.env['NODE_ENV'] === 'test';
        return isTest ? new TestRateLimiterService() : new RedisRateLimiterService(redis);
      },
      inject: [RATE_LIMIT_REDIS],
    },
    {
      provide: RATE_LIMITER,
      useExisting: RateLimiterService,
    },
    {
      provide: RateLimitInterceptor,
      useFactory: (rateLimiterService: RateLimiter) => new RateLimitInterceptor(rateLimiterService),
      inject: [RATE_LIMITER],
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

function createNoopRateLimitRedis(): SlidingWindowRedis {
  return {
    connect: async () => undefined,
    quit: async () => 'OK',
    disconnect: () => undefined,
    slidingWindow: async () => [1, 1, 1, 0, 0, 'minute'],
  } as unknown as SlidingWindowRedis;
}
