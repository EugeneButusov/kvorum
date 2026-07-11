import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import Redis from 'ioredis';
import { UsageInterceptor } from './usage.interceptor';
import { UsageStore } from './usage.store';

const USAGE_REDIS = Symbol('USAGE_REDIS');

// lazyConnect so booting AppModule (OpenAPI generation, unit tests) needs no live Redis; the socket
// opens on the first recorded request. Usage recording is best-effort, so a low retry ceiling is fine.
function createUsageRedis(): Redis {
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  redis.on('error', () => {
    // Swallow — usage is non-critical; the interceptor logs and continues.
  });
  return redis;
}

class UsageRedisLifecycle implements OnApplicationShutdown {
  constructor(private readonly redis: Redis) {}

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
    { provide: USAGE_REDIS, useFactory: createUsageRedis },
    {
      provide: UsageStore,
      useFactory: (redis: Redis) => new UsageStore(redis),
      inject: [USAGE_REDIS],
    },
    {
      provide: UsageRedisLifecycle,
      useFactory: (redis: Redis) => new UsageRedisLifecycle(redis),
      inject: [USAGE_REDIS],
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (usage: UsageStore) => new UsageInterceptor(usage),
      inject: [UsageStore],
    },
  ],
  exports: [UsageStore],
})
export class UsageModule {}
