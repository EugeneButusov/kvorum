import { afterEach, describe, it, expect, vi } from 'vitest';
import { SnapshotClient, DEFAULT_SNAPSHOT_GRAPHQL_URL } from './client';

function gql(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

const liveSignal = (): AbortSignal => new AbortController().signal;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SnapshotClient', () => {
  it('POSTs the proposals query with the cursor variables and returns the rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(gql({ proposals: [{ id: 'p1', created: 10 }] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SnapshotClient();
    const rows = await client.fetchProposals({
      space: 'lido-snapshot.eth',
      createdGte: 5,
      first: 100,
      skip: 200,
      signal: liveSignal(),
    });

    expect(rows).toEqual([{ id: 'p1', created: 10 }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(DEFAULT_SNAPSHOT_GRAPHQL_URL);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.query).toContain('proposals(');
    expect(body.variables).toEqual({
      space: 'lido-snapshot.eth',
      createdGte: 5,
      first: 100,
      skip: 200,
    });
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['x-api-key']).toBeUndefined();
  });

  it('sends the votes query and the x-api-key header when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(gql({ votes: [{ id: 'v1', created: 9 }] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SnapshotClient({ apiKey: 'secret', url: 'https://custom/graphql' });
    const rows = await client.fetchVotes({
      space: 's',
      createdGte: 0,
      first: 100,
      skip: 0,
      signal: liveSignal(),
    });

    expect(rows).toEqual([{ id: 'v1', created: 9 }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://custom/graphql');
    expect(JSON.parse(init.body as string).query).toContain('votes(');
    expect(init.headers['x-api-key']).toBe('secret');
  });

  it('returns an empty array when the field is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(gql({})));
    const client = new SnapshotClient();
    await expect(
      client.fetchProposals({
        space: 's',
        createdGte: 0,
        first: 100,
        skip: 0,
        signal: liveSignal(),
      }),
    ).resolves.toEqual([]);
  });

  it('throws on GraphQL errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ errors: [{ message: 'bad query' }] }), { status: 200 }),
        ),
    );
    const client = new SnapshotClient();
    await expect(
      client.fetchProposals({
        space: 's',
        createdGte: 0,
        first: 100,
        skip: 0,
        signal: liveSignal(),
      }),
    ).rejects.toThrow(/bad query/);
  });

  it('retries on a 5xx then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(gql({ proposals: [{ id: 'p1', created: 1 }] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SnapshotClient({ backoffBaseMs: 1 });
    const rows = await client.fetchProposals({
      space: 's',
      createdGte: 0,
      first: 100,
      skip: 0,
      signal: liveSignal(),
    });
    expect(rows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('backs off on a 429 honouring Retry-After, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(gql({ votes: [{ id: 'v1', created: 1 }] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SnapshotClient({ backoffBaseMs: 1 });
    const rows = await client.fetchVotes({
      space: 's',
      createdGte: 0,
      first: 100,
      skip: 0,
      signal: liveSignal(),
    });
    expect(rows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting the retry budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SnapshotClient({ backoffBaseMs: 1, maxRetries: 2 });
    await expect(
      client.fetchProposals({
        space: 's',
        createdGte: 0,
        first: 100,
        skip: 0,
        signal: liveSignal(),
      }),
    ).rejects.toThrow();
    // initial + 2 retries = 3 attempts
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry once the per-tick signal is aborted', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort(new Error('tick-timeout'));
      return Promise.reject(new Error('aborted'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new SnapshotClient({ backoffBaseMs: 1 });
    await expect(
      client.fetchProposals({
        space: 's',
        createdGte: 0,
        first: 100,
        skip: 0,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('threads the abort signal into fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(gql({ proposals: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const signal = liveSignal();

    const client = new SnapshotClient();
    await client.fetchProposals({ space: 's', createdGte: 0, first: 100, skip: 0, signal });
    expect(fetchMock.mock.calls[0]![1].signal).toBe(signal);
  });
});
