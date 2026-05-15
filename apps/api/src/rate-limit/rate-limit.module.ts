import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { parseRateLimitConfigFromEnv } from './rate-limit.config';
import { RateLimitInterceptor } from './rate-limit.interceptor';
import { RateLimiterService } from './rate-limiter.service';
import { createRateLimitRedis, type SlidingWindowRedis } from './redis.client';

const RATE_LIMIT_CONFIG = Symbol('RATE_LIMIT_CONFIG');
const RATE_LIMIT_REDIS = Symbol('RATE_LIMIT_REDIS');

class RedisShutdownHook implements OnApplicationShutdown {
  constructor(private readonly redis: SlidingWindowRedis) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
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
      useFactory: (config: ReturnType<typeof parseRateLimitConfigFromEnv>) =>
        createRateLimitRedis(config),
      inject: [RATE_LIMIT_CONFIG],
    },
    {
      provide: RateLimiterService,
      useFactory: (redis: SlidingWindowRedis) => new RateLimiterService(redis),
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
      provide: RedisShutdownHook,
      useFactory: (redis: SlidingWindowRedis) => new RedisShutdownHook(redis),
      inject: [RATE_LIMIT_REDIS],
    },
  ],
})
export class RateLimitModule {}
