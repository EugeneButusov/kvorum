import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { describe, expect, it, vi } from 'vitest';
import { CACHE_CONTROL_KEY, type CacheControlOptions } from './cache-control.decorator';
import { EtagInterceptor, etagTesting } from './etag.interceptor';
import type { ResponseNormalizer } from './response-normalizer';

function createExecutionContext(req: Record<string, unknown>, res: Record<string, unknown>) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getHandler: () => function handler() {},
    getClass: () => class TestClass {},
  } as unknown as ExecutionContext;
}

describe('etagTesting helpers', () => {
  it('computes deterministic strong etag', () => {
    const left = etagTesting.computeStrongEtag({ a: 1 });
    const right = etagTesting.computeStrongEtag({ a: 1 });
    expect(left).toBe(right);
    expect(left).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
  });

  it('parses and matches If-None-Match tokens by equality only', () => {
    expect(etagTesting.parseIfNoneMatch('W/"abc", "xyz"')).toEqual(['"abc"', '"xyz"']);
    expect(etagTesting.hasTokenMatch('W/"abc", "xyz"', '"abc"')).toBe(true);
    expect(etagTesting.hasTokenMatch('"abc"', '"abcdef"')).toBe(false);
    expect(etagTesting.hasTokenMatch('*', '"anything"')).toBe(true);
  });

  it('serializes cache-control directives', () => {
    const opts: CacheControlOptions = {
      visibility: 'private',
      maxAgeSecs: 60,
      sMaxAgeSecs: 120,
      staleWhileRevalidateSecs: 30,
    };
    expect(etagTesting.serializeCacheControl(undefined)).toBe('no-cache');
    expect(etagTesting.serializeCacheControl(opts)).toBe(
      'private, max-age=60, s-maxage=120, stale-while-revalidate=30',
    );
  });
});

describe('EtagInterceptor', () => {
  it('hashes normalized output and returns normalized body', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === CACHE_CONTROL_KEY) {
        return { visibility: 'public', maxAgeSecs: 120 };
      }
      return undefined;
    });

    const normalizer: ResponseNormalizer = {
      normalize: () => ({ normalized: true }),
    };

    const interceptor = new EtagInterceptor(reflector, normalizer);
    const req = { method: 'GET', header: () => undefined };
    const headers = new Map<string, string>();
    const res = {
      statusCode: 200,
      setHeader: (k: string, v: string) => headers.set(k, v),
      status: vi.fn(),
      end: vi.fn(),
    };

    const ctx = createExecutionContext(req, res);
    const out = await lastValueFrom(
      interceptor
        .intercept(ctx, { handle: () => of({ raw: true }) } as CallHandler)
        .pipe(toArray()),
    );

    expect(out).toEqual([{ normalized: true }]);
    expect(headers.get('Cache-Control')).toBe('public, max-age=120');
    expect(headers.get('ETag')).toBe(etagTesting.computeStrongEtag({ normalized: true }));
  });

  it('returns 304 with empty body on token match', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === CACHE_CONTROL_KEY) {
        return { visibility: 'public', maxAgeSecs: 60 };
      }
      return undefined;
    });
    const interceptor = new EtagInterceptor(reflector, { normalize: (value) => value });
    const etag = etagTesting.computeStrongEtag({ ok: true });

    const req = { method: 'GET', header: () => `W/${etag}, \"other\"` };
    const headers = new Map<string, string>();
    const res = {
      statusCode: 200,
      setHeader: (k: string, v: string) => headers.set(k, v),
      status: vi.fn(),
      end: vi.fn(),
    };

    const ctx = createExecutionContext(req, res);
    const out = await lastValueFrom(
      interceptor.intercept(ctx, { handle: () => of({ ok: true }) } as CallHandler).pipe(toArray()),
    );

    expect(out).toEqual([]);
    expect(res.status).toHaveBeenCalledWith(304);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('skips non-GET requests and non-2xx responses', async () => {
    const reflector = new Reflector();
    const interceptor = new EtagInterceptor(reflector, { normalize: (value) => value });

    const postReq = { method: 'POST', header: () => undefined };
    const postRes = { statusCode: 200, setHeader: vi.fn(), status: vi.fn(), end: vi.fn() };
    const postCtx = createExecutionContext(postReq, postRes);
    const postOut = await lastValueFrom(
      interceptor
        .intercept(postCtx, { handle: () => of({ ok: true }) } as CallHandler)
        .pipe(toArray()),
    );
    expect(postOut).toEqual([{ ok: true }]);
    expect(postRes.setHeader).not.toHaveBeenCalled();

    const getReq = { method: 'GET', header: () => undefined };
    const errRes = { statusCode: 500, setHeader: vi.fn(), status: vi.fn(), end: vi.fn() };
    const getCtx = createExecutionContext(getReq, errRes);
    const errOut = await lastValueFrom(
      interceptor
        .intercept(getCtx, { handle: () => of({ ok: false }) } as CallHandler)
        .pipe(toArray()),
    );
    expect(errOut).toEqual([{ ok: false }]);
    expect(errRes.setHeader).not.toHaveBeenCalled();
  });

  it('sets cache-control on 3xx responses for cache-decorated routes without etag', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === CACHE_CONTROL_KEY) {
        return { visibility: 'public', maxAgeSecs: 60 };
      }
      return undefined;
    });
    const interceptor = new EtagInterceptor(reflector, { normalize: (value) => value });

    const req = { method: 'GET', header: () => undefined };
    const headers = new Map<string, string>();
    const res = {
      statusCode: 301,
      setHeader: (k: string, v: string) => headers.set(k, v),
      status: vi.fn(),
      end: vi.fn(),
    };

    const ctx = createExecutionContext(req, res);
    const out = await lastValueFrom(
      interceptor.intercept(ctx, { handle: () => of({ ok: true }) } as CallHandler).pipe(toArray()),
    );

    expect(out).toEqual([{ ok: true }]);
    expect(headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(headers.has('ETag')).toBe(false);
  });
});
