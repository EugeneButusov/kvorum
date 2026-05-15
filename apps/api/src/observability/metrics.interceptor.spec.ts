import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lastValueFrom, of, throwError } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { apiMetrics } from './api-metrics';
import { deriveRouteLabel, MetricsInterceptor } from './metrics.interceptor';

describe('deriveRouteLabel', () => {
  it('builds route template labels from baseUrl + route.path', () => {
    expect(deriveRouteLabel({ baseUrl: '/v1/daos', route: { path: ':slug/proposals' } })).toBe(
      '/v1/daos/:slug/proposals',
    );
    expect(deriveRouteLabel({ route: { path: '/health' } })).toBe('/health');
  });

  it('returns unknown when route is missing', () => {
    expect(deriveRouteLabel({})).toBe('unknown');
  });
});

function createContext(
  req: Record<string, unknown>,
  res: Record<string, unknown>,
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe('MetricsInterceptor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('records request count + latency for successful responses', async () => {
    const requestsSpy = vi.spyOn(apiMetrics.requests, 'add');
    const latencySpy = vi.spyOn(apiMetrics.latencySeconds, 'record');

    const interceptor = new MetricsInterceptor();
    const req = { method: 'GET', baseUrl: '/v1', route: { path: 'items/:id' } };
    const res = { statusCode: 200 };

    const output = await lastValueFrom(
      interceptor
        .intercept(createContext(req, res), { handle: () => of({ ok: true }) } as CallHandler)
        .pipe(toArray()),
    );

    expect(output).toEqual([{ ok: true }]);
    expect(requestsSpy).toHaveBeenCalledWith(1, {
      method: 'GET',
      route: '/v1/items/:id',
      status: '200',
    });
    expect(latencySpy).toHaveBeenCalled();
  });

  it('records metrics on thrown errors via finalize', async () => {
    const requestsSpy = vi.spyOn(apiMetrics.requests, 'add');
    const latencySpy = vi.spyOn(apiMetrics.latencySeconds, 'record');

    const interceptor = new MetricsInterceptor();
    const req = { method: 'GET' };
    const res = { statusCode: 503 };

    await expect(
      lastValueFrom(
        interceptor
          .intercept(createContext(req, res), {
            handle: () => throwError(() => new Error('boom')),
          } as CallHandler)
          .pipe(toArray()),
      ),
    ).rejects.toThrow('boom');

    expect(requestsSpy).toHaveBeenCalledWith(1, {
      method: 'GET',
      route: 'unknown',
      status: '503',
    });
    expect(latencySpy).toHaveBeenCalled();
  });
});
