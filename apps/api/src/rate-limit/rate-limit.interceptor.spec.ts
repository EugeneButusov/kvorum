import { HttpException, InternalServerErrorException } from '@nestjs/common';
import { of } from 'rxjs';
import { RateLimitInterceptor } from './rate-limit.interceptor';
import { RedisUnavailableError } from './rate-limiter.service';
import { apiMetrics } from '../observability/api-metrics';

vi.mock('../observability/api-metrics', () => ({
  apiMetrics: {
    pepperMatch: { add: vi.fn() },
    authRejections: { add: vi.fn() },
    rateLimitRejections: { add: vi.fn() },
  },
}));

type HttpContextMock = {
  switchToHttp: () => {
    getRequest: () => Record<string, unknown>;
    getResponse: () => { setHeader: (name: string, value: string) => void };
  };
};

describe('RateLimitInterceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-ops when request has no apiKey', async () => {
    const consume = vi.fn();
    const interceptor = new RateLimitInterceptor({ consume } as never);
    const next = { handle: vi.fn(() => of({ ok: true })) };

    const setHeader = vi.fn();
    const context: HttpContextMock = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
        getResponse: () => ({ setHeader }),
      }),
    };

    await interceptor.intercept(context as never, next as never);

    expect(consume).not.toHaveBeenCalled();
    expect(setHeader).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalled();
  });

  it('sets headers and allows request when quota is available', async () => {
    const consume = vi.fn(async () => ({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetSeconds: 60,
      retryAfterSeconds: 0,
      bindingWindow: 'minute',
    }));
    const interceptor = new RateLimitInterceptor({ consume } as never);
    const next = { handle: vi.fn(() => of({ ok: true })) };

    const setHeader = vi.fn();
    const context: HttpContextMock = {
      switchToHttp: () => ({
        getRequest: () => ({ apiKey: { id: 'k1', tier: 'authenticated_free' } }),
        getResponse: () => ({ setHeader }),
      }),
    };

    await interceptor.intercept(context as never, next as never);

    expect(setHeader).toHaveBeenCalledWith('RateLimit-Limit', '60');
    expect(setHeader).toHaveBeenCalledWith('RateLimit-Remaining', '59');
    expect(setHeader).toHaveBeenCalledWith('RateLimit-Reset', '60');
    expect(next.handle).toHaveBeenCalled();
  });

  it('throws 429 and increments minute quota metric', async () => {
    const consume = vi.fn(async () => ({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetSeconds: 12,
      retryAfterSeconds: 12,
      bindingWindow: 'minute',
    }));
    const interceptor = new RateLimitInterceptor({ consume } as never);

    const setHeader = vi.fn();
    const context: HttpContextMock = {
      switchToHttp: () => ({
        getRequest: () => ({ apiKey: { id: 'k1', tier: 'authenticated_free' } }),
        getResponse: () => ({ setHeader }),
      }),
    };

    await expect(
      interceptor.intercept(context as never, { handle: vi.fn(() => of({ ok: true })) } as never),
    ).rejects.toBeInstanceOf(HttpException);

    expect(apiMetrics.rateLimitRejections.add).toHaveBeenCalledWith(1, {
      tier: 'authenticated_free',
      reason: 'quota_minute',
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '12');
  });

  it('throws 429 and increments day quota metric', async () => {
    const consume = vi.fn(async () => ({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetSeconds: 1,
      retryAfterSeconds: 86400,
      bindingWindow: 'day',
    }));
    const interceptor = new RateLimitInterceptor({ consume } as never);

    const setHeader = vi.fn();
    const context: HttpContextMock = {
      switchToHttp: () => ({
        getRequest: () => ({ apiKey: { id: 'k1', tier: 'authenticated_free' } }),
        getResponse: () => ({ setHeader }),
      }),
    };

    await expect(
      interceptor.intercept(context as never, { handle: vi.fn(() => of({ ok: true })) } as never),
    ).rejects.toBeInstanceOf(HttpException);

    expect(apiMetrics.rateLimitRejections.add).toHaveBeenCalledWith(1, {
      tier: 'authenticated_free',
      reason: 'quota_day',
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '86400');
  });

  it('throws 503 and increments redis_unavailable metric', async () => {
    const consume = vi.fn(async () => {
      throw new RedisUnavailableError(new Error('down'));
    });
    const interceptor = new RateLimitInterceptor({ consume } as never);

    const setHeader = vi.fn();
    const context: HttpContextMock = {
      switchToHttp: () => ({
        getRequest: () => ({ apiKey: { id: 'k1', tier: 'authenticated_free' } }),
        getResponse: () => ({ setHeader }),
      }),
    };

    await expect(
      interceptor.intercept(context as never, { handle: vi.fn(() => of({ ok: true })) } as never),
    ).rejects.toMatchObject({ status: 503 });

    expect(apiMetrics.rateLimitRejections.add).toHaveBeenCalledWith(1, {
      tier: 'authenticated_free',
      reason: 'redis_unavailable',
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '5');
  });

  it('throws 500 on unknown tier', async () => {
    const interceptor = new RateLimitInterceptor({ consume: vi.fn() } as never);
    const context: HttpContextMock = {
      switchToHttp: () => ({
        getRequest: () => ({ apiKey: { id: 'k1', tier: 'mystery_tier' } }),
        getResponse: () => ({ setHeader: vi.fn() }),
      }),
    };

    await expect(
      interceptor.intercept(context as never, { handle: vi.fn(() => of({ ok: true })) } as never),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
