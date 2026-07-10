import { afterEach, beforeEach, vi } from 'vitest';

import { GET } from './route';

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
});
