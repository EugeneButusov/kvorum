import { Injectable } from '@nestjs/common';
import { TIERS, type Tier } from './rate-limit.config';
import type { SlidingWindowRedis } from './redis.client';

export class RedisUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Redis unavailable for rate limiting');
    this.name = 'RedisUnavailableError';

    if (cause instanceof Error && cause.stack !== undefined) {
      this.stack = cause.stack;
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
  bindingWindow: 'minute' | 'day';
}

@Injectable()
export class RateLimiterService {
  constructor(private readonly redis: SlidingWindowRedis) {}

  async consume(identity: string, tier: Tier, nowMs = Date.now()): Promise<RateLimitResult> {
    const limits = TIERS[tier];
    const keys = [`rl:${identity}:m`, `rl:${identity}:d`];
    const requestMember = `${nowMs}:${Math.random().toString(36).slice(2, 12)}`;

    try {
      const response = await this.redis.slidingWindow(
        ...keys,
        nowMs,
        limits.perMinute,
        limits.perDay,
        requestMember,
      );

      return mapResult(response);
    } catch (error: unknown) {
      throw new RedisUnavailableError(error);
    }
  }
}

function mapResult(value: [number, number, number, number, number, string]): RateLimitResult {
  const [allowed, limit, remaining, resetSeconds, retryAfterSeconds, bindingWindow] = value;
  if (bindingWindow !== 'minute' && bindingWindow !== 'day') {
    throw new Error(`Unknown binding window from script: ${bindingWindow}`);
  }

  return {
    allowed: allowed === 1,
    limit,
    remaining,
    resetSeconds,
    retryAfterSeconds,
    bindingWindow,
  };
}
