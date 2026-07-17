import { afterEach, vi } from 'vitest';

import { fetchDegradedStatus } from './health';

describe('fetchDegradedStatus', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function mockHealth(res: Response) {
    global.fetch = vi.fn(async () => res) as unknown as typeof fetch;
  }

  it('returns null when the service is healthy', async () => {
    mockHealth(
      new Response(JSON.stringify({ status: 'ok', timestamp: 't' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(fetchDegradedStatus()).resolves.toBeNull();
  });

  it('surfaces the reason + retry from a degraded payload', async () => {
    mockHealth(
      new Response(
        JSON.stringify({
          status: 'degraded',
          degraded: { reason: 'Vote ingestion lagging 8 min', retryAfterSeconds: 120 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(fetchDegradedStatus()).resolves.toEqual({
      reason: 'Vote ingestion lagging 8 min',
      retryAfterSeconds: 120,
    });
  });

  it('treats a 503 from the health check itself as degraded, reading Retry-After', async () => {
    mockHealth(new Response(null, { status: 503, headers: { 'retry-after': '600' } }));
    const result = await fetchDegradedStatus();
    expect(result?.retryAfterSeconds).toBe(600);
  });

  it('returns null (no false alarm) when health is unreachable', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(fetchDegradedStatus()).resolves.toBeNull();
  });
});
