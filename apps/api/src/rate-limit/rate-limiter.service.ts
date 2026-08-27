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

export interface WindowState {
  used: number;
  limit: number;
  resetSeconds: number;
}

export interface PeekResult {
  minute: WindowState;
  day: WindowState;
}

export interface RateLimiter {
  consume(identity: string, tier: Tier, nowMs?: number): Promise<RateLimitResult>;
  peek(identity: string, tier: Tier, nowMs?: number): Promise<PeekResult>;
}

@Injectable()
export class RedisRateLimiterService implements RateLimiter {
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

  async peek(identity: string, tier: Tier, nowMs = Date.now()): Promise<PeekResult> {
    const limits = TIERS[tier];
    const keys: [string, string] = [`rl:${identity}:m`, `rl:${identity}:d`];

    try {
      const [minuteCount, minuteReset, dayCount, dayReset] = await this.redis.peekSlidingWindow(
        ...keys,
        nowMs,
      );

      return {
        minute: { used: minuteCount, limit: limits.perMinute, resetSeconds: minuteReset },
        day: { used: dayCount, limit: limits.perDay, resetSeconds: dayReset },
      };
    } catch (error: unknown) {
      throw new RedisUnavailableError(error);
    }
  }
}

@Injectable()
export class RateLimiterService extends RedisRateLimiterService {}

@Injectable()
export class TestRateLimiterService implements RateLimiter {
  async consume(): Promise<RateLimitResult> {
    return {
      allowed: true,
      limit: Number.MAX_SAFE_INTEGER,
      remaining: Number.MAX_SAFE_INTEGER,
      resetSeconds: 0,
      retryAfterSeconds: 0,
      bindingWindow: 'minute',
    };
  }

  async peek(_identity: string, tier: Tier): Promise<PeekResult> {
    const limits = TIERS[tier];
    return {
      minute: { used: 0, limit: limits.perMinute, resetSeconds: 0 },
      day: { used: 0, limit: limits.perDay, resetSeconds: 0 },
    };
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
