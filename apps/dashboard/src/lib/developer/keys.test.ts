import { afterEach, beforeEach, vi } from 'vitest';

import { createKey, fetchKeys, revokeKey, rotateKey } from './keys';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('developer keys client', () => {
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

  it('fetchKeys unwraps the {data} envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'k1' }] }));
    await expect(fetchKeys()).resolves.toEqual([{ id: 'k1' }]);
  });

  it('createKey sends a trimmed label, or an empty body when omitted', async () => {
    // Fresh Response per call — a Response body can only be read once.
    fetchMock.mockImplementation(async () => jsonResponse({ id: 'k1', key: 'kv_live_x' }));

    await createKey('  prod  ');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ label: 'prod' });

    await createKey('   ');
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({});

    await createKey();
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({});
  });

  it('rotateKey posts to the rotate sub-resource', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'k2', key: 'kv_live_y' }));
    await rotateKey('k1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/keys/k1/rotate');
    expect(init.method).toBe('POST');
  });

  it('revokeKey issues a DELETE', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await revokeKey('k1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/keys/k1');
    expect(init.method).toBe('DELETE');
  });
});
