import { NextRequest } from 'next/server';

import { proxy } from './proxy';

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

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
