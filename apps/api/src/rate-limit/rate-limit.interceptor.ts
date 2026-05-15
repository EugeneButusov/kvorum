import {
  Injectable,
  InternalServerErrorException,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { TIERS, type Tier } from './rate-limit.config';
import {
  RateLimiterService,
  RedisUnavailableError,
  type RateLimitResult,
} from './rate-limiter.service';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { problemException } from '../http/problem-exception';
import { apiMetrics } from '../observability/api-metrics';

const SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS = 5;

@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitInterceptor.name);

  constructor(private readonly rateLimiter: RateLimiterService) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<Partial<AuthenticatedRequest>>();
    const response = http.getResponse<{ setHeader: (name: string, value: string) => void }>();

    if (request.apiKey === undefined) {
      return next.handle();
    }

    const tier = request.apiKey.tier;
    if (!isTier(tier)) {
      this.logger.error(`Unknown API key tier: ${String(tier)}`);
      throw new InternalServerErrorException('Unknown API key tier');
    }

    let result: RateLimitResult;
    try {
      result = await this.rateLimiter.consume(`apikey:${request.apiKey.id}`, tier);
    } catch (error: unknown) {
      if (!(error instanceof RedisUnavailableError)) {
        throw error;
      }

      // SPEC §7.3 calls this "fall-open": Redis down -> reject (503), NOT silent allow.
      // The name is counterintuitive; do not change this to allow traffic through.
      response.setHeader('Retry-After', String(SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS));
      apiMetrics.rateLimitRejections.add(1, { tier, reason: 'redis_unavailable' });
      this.logger.warn('Rate limiter Redis unavailable — returning 503 (fall-open)');
      throw problemException('service-unavailable', {
        detail: 'Rate limiter backend is unavailable.',
      });
    }

    response.setHeader('RateLimit-Limit', String(result.limit));
    response.setHeader('RateLimit-Remaining', String(result.remaining));
    response.setHeader('RateLimit-Reset', String(result.resetSeconds));

    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
      apiMetrics.rateLimitRejections.add(1, {
        tier,
        reason: result.bindingWindow === 'day' ? 'quota_day' : 'quota_minute',
      });
      throw problemException('rate-limited', { detail: 'Rate limit exceeded.' });
    }

    return next.handle();
  }
}

function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && value in TIERS;
}
