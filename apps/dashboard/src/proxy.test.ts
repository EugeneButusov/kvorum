import { NextRequest } from 'next/server';
import { afterEach } from 'vitest';

import { proxy } from './proxy';

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

afterEach(() => {
  delete process.env.MAINTENANCE_MODE;
});

describe('protected-route proxy', () => {
  it('redirects to login with a return URL when no session cookie is present', () => {
    const res = proxy(request('/developer'));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/developer');
  });

  it('preserves the full path + query in the return URL', () => {
    const res = proxy(request('/developer/keys?tab=usage'));
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('next')).toBe('/developer/keys?tab=usage');
  });

  it('lets the request through when the session cookie is present', () => {
    const res = proxy(request('/developer', 'kv_session=abc'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});

describe('maintenance mode', () => {
  it('serves a 503 with Retry-After and rewrites to /maintenance site-wide', () => {
    process.env.MAINTENANCE_MODE = '1';
    const res = proxy(request('/daos/lido'));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('3600');
    expect(res.headers.get('x-middleware-rewrite')).toContain('/maintenance');
  });

  it('takes precedence over the /developer auth check', () => {
    process.env.MAINTENANCE_MODE = '1';
    const res = proxy(request('/developer'));
    expect(res.status).toBe(503);
  });

  it('does not rewrite the maintenance page onto itself', () => {
    process.env.MAINTENANCE_MODE = '1';
    const res = proxy(request('/maintenance'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('is inert when the flag is unset', () => {
    const res = proxy(request('/daos/lido'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
