import { afterEach, beforeEach, vi } from 'vitest';

import { ApiError, sessionGet, sessionMutate } from './session';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('session fetch helpers', () => {
  const realFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    document.cookie = 'kv_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('sessionGet hits the BFF with same-origin credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    await sessionGet('/v1/keys');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/keys', { credentials: 'same-origin' });
  });

  it('sessionMutate attaches the CSRF header from the cookie and serialises the body', async () => {
    document.cookie = 'kv_csrf=tok-9';
    fetchMock.mockResolvedValue(jsonResponse({ id: 'k1' }));
    await sessionMutate('POST', '/v1/keys', { label: 'ci' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/keys');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers['x-csrf-token']).toBe('tok-9');
    expect(JSON.parse(init.body)).toEqual({ label: 'ci' });
  });

  it('sessionMutate returns undefined for a 204 (no body to parse)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(sessionMutate('DELETE', '/v1/account')).resolves.toBeUndefined();
  });

  it('throws ApiError with the problem detail on non-2xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Key not found' }, 404));
    await expect(sessionMutate('DELETE', '/v1/keys/x')).rejects.toMatchObject({
      status: 404,
      message: 'Key not found',
    } satisfies Partial<ApiError>);
  });
});
