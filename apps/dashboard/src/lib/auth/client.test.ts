import { afterEach, beforeEach, vi } from 'vitest';

import { AuthError, fetchSession, logout, verifySiwe } from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('auth client', () => {
  const realFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    // Clear any csrf cookie between tests.
    document.cookie = 'kv_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('fetchSession returns null on 401 rather than throwing', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(fetchSession()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/session', { credentials: 'same-origin' });
  });

  it('verifySiwe posts through the BFF and returns the session', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ userId: 'u1', address: '0xabc' }));
    const result = await verifySiwe({ message: 'm', signature: 's' });
    expect(result).toEqual({ userId: 'u1', address: '0xabc' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/siwe/verify');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(init.body)).toEqual({ message: 'm', signature: 's' });
  });

  it('attaches the double-submit CSRF header from the cookie on mutations', async () => {
    document.cookie = 'kv_csrf=tok-123';
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await logout();
    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers['x-csrf-token']).toBe('tok-123');
  });

  it('throws AuthError with the problem detail on non-2xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'SIWE verification failed' }, 401));
    await expect(verifySiwe({ message: 'm', signature: 's' })).rejects.toMatchObject({
      status: 401,
      message: 'SIWE verification failed',
    } satisfies Partial<AuthError>);
  });
});
