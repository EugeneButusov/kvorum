import { Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { parseRateLimitConfigFromEnv } from './rate-limit.config';
import { RateLimitInterceptor } from './rate-limit.interceptor';
import {
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
      provide: RATE_LIMITER,
      useFactory: (redis: SlidingWindowRedis) => {
        const isTest = process.env['NODE_ENV'] === 'test';
        return isTest ? new TestRateLimiterService() : new RedisRateLimiterService(redis);
      },
      inject: [RATE_LIMIT_REDIS],
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
