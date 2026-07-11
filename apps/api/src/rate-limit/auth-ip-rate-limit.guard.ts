import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { RedisUnavailableError, type RateLimiter } from './rate-limiter.service';
import { RATE_LIMITER } from './rate-limiter.token';
import { problemException } from '../http/problem-exception';
import { apiMetrics } from '../observability/api-metrics';

const SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS = 5;

// Per-IP rate limit for unauthenticated auth endpoints (SIWE nonce/verify). Independent of the
// per-key limiter (which only acts once request.apiKey is set). Applied via @UseGuards on the auth
// controller. IP comes from req.ip, so `trust proxy` must be configured (see main.ts).
@Injectable()
export class AuthIpRateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ ip?: string }>();
    const response = http.getResponse<{ setHeader: (name: string, value: string) => void }>();

    const ip = request.ip ?? 'unknown';

    let result;
    try {
      result = await this.rateLimiter.consume(`authip:${ip}`, 'auth_ip');
    } catch (error: unknown) {
      if (!(error instanceof RedisUnavailableError)) {
        throw error;
      }
      // Fall-open = reject with 503 (never silently allow), matching the per-key limiter.
      response.setHeader('Retry-After', String(SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS));
      apiMetrics.rateLimitRejections.add(1, { tier: 'auth_ip', reason: 'redis_unavailable' });
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
        tier: 'auth_ip',
        reason: result.bindingWindow === 'day' ? 'quota_day' : 'quota_minute',
      });
      throw problemException('rate-limited', { detail: 'Too many requests from this IP.' });
    }

    return true;
  }
}
