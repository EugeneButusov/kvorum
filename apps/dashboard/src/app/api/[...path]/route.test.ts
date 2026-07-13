import { afterEach, beforeEach, vi } from 'vitest';

import { DELETE, GET, POST } from './route';

const params = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe('BFF GET proxy', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.BACKEND_API_URL = 'http://api.test';
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('proxies to the API, forwards If-None-Match, and passes headers through (reads are open)', async () => {
    const captured: { url?: string; headers?: Headers } = {};
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      captured.url = url.toString();
      captured.headers = new Headers(init?.headers);
      return new Response('{"data":[]}', {
        status: 200,
        headers: {
          ETag: '"abc"',
          'RateLimit-Remaining': '59',
          'Content-Type': 'application/json',
        },
      });
    });

    const req = new Request('http://localhost:3000/api/v1/daos?limit=5', {
      headers: { 'if-none-match': '"abc"' },
    });
    const res = await GET(req, params(['v1', 'daos']));

    expect(captured.url).toBe('http://api.test/v1/daos?limit=5');
    // No key is attached yet — key enforcement + injection arrive with the auth backend.
    expect(captured.headers?.has('Authorization')).toBe(false);
    expect(captured.headers?.get('If-None-Match')).toBe('"abc"');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('"abc"');
    expect(res.headers.get('ratelimit-remaining')).toBe('59');
  });

  it('passes a 304 through with no body', async () => {
    global.fetch = vi.fn(
      async () => new Response(null, { status: 304, headers: { ETag: '"abc"' } }),
    );

    const req = new Request('http://localhost:3000/api/v1/daos', {
      headers: { 'if-none-match': '"abc"' },
    });
    const res = await GET(req, params(['v1', 'daos']));

    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
  });

  it('forwards the cookie header upstream on reads (session-authed BFF)', async () => {
    const captured: { headers?: Headers } = {};
    global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured.headers = new Headers(init?.headers);
      return new Response('{}', { status: 200 });
    });

    const req = new Request('http://localhost:3000/api/v1/auth/session', {
      headers: { cookie: 'kv_session=abc' },
    });
    await GET(req, params(['v1', 'auth', 'session']));
    expect(captured.headers?.get('Cookie')).toBe('kv_session=abc');
  });
});

describe('BFF POST proxy', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.BACKEND_API_URL = 'http://api.test';
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('forwards body, cookie and CSRF header upstream and relays Set-Cookie back', async () => {
    const captured: { url?: string; headers?: Headers; body?: string } = {};
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      captured.url = url.toString();
      captured.headers = new Headers(init?.headers);
      captured.body = init?.body as string;
      return new Response('{"userId":"u1","address":"0xabc"}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'kv_session=sess; Path=/; HttpOnly',
        },
      });
    });

    const req = new Request('http://localhost:3000/api/v1/auth/siwe/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'kv_csrf=tok',
        'x-csrf-token': 'tok',
      },
      body: JSON.stringify({ message: 'm', signature: 's' }),
    });
    const res = await POST(req, params(['v1', 'auth', 'siwe', 'verify']));

    expect(captured.url).toBe('http://api.test/v1/auth/siwe/verify');
    expect(captured.headers?.get('cookie')).toBe('kv_csrf=tok');
    expect(captured.headers?.get('x-csrf-token')).toBe('tok');
    expect(JSON.parse(captured.body ?? '{}')).toEqual({ message: 'm', signature: 's' });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toContain('kv_session=sess; Path=/; HttpOnly');
  });
});

describe('BFF DELETE proxy', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.BACKEND_API_URL = 'http://api.test';
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('forwards cookie + CSRF and passes a 204 through with no body', async () => {
    const captured: { url?: string; method?: string; headers?: Headers } = {};
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      captured.url = url.toString();
      captured.method = init?.method;
      captured.headers = new Headers(init?.headers);
      return new Response(null, { status: 204 });
    });

    const req = new Request('http://localhost:3000/api/v1/keys/k1', {
      method: 'DELETE',
      headers: { cookie: 'kv_session=s; kv_csrf=tok', 'x-csrf-token': 'tok' },
    });
    const res = await DELETE(req, params(['v1', 'keys', 'k1']));

    expect(captured.url).toBe('http://api.test/v1/keys/k1');
    expect(captured.method).toBe('DELETE');
    expect(captured.headers?.get('cookie')).toBe('kv_session=s; kv_csrf=tok');
    expect(captured.headers?.get('x-csrf-token')).toBe('tok');
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });
});
