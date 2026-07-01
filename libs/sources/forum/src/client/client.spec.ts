import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscourseClient, NonRetriableDiscourseError } from './client';
import {
  categoryPage,
  jsonResponse,
  postsResponse,
  topicResponse,
} from '../../tests/fixtures/discourse-responses';

const BASE = 'https://research.lido.fi';
const liveSignal = (): AbortSignal => new AbortController().signal;

function client(overrides = {}): DiscourseClient {
  // No proactive pacing in unit tests: a wide-open window so the request path is what's exercised.
  return new DiscourseClient({
    baseUrl: BASE,
    backoffBaseMs: 1,
    pacer: { maxPerShortWindow: 1_000_000, maxPerLongWindow: 1_000_000 },
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DiscourseClient — requests', () => {
  it('sends a real User-Agent and requests the 0-indexed category page URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(categoryPage({ topicIds: [1], moreTopicsUrl: null })));
    vi.stubGlobal('fetch', fetchMock);

    const { topics, moreTopicsUrl } = await client().fetchCategoryPage(
      'proposals',
      9,
      0,
      liveSignal(),
    );

    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      topicId: 1,
      slug: 'proposal-1',
      postCount: 3,
      tags: ['proposal'],
    });
    expect(moreTopicsUrl).toBeNull();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/c/proposals/9.json?page=0`);
    expect(init.method).toBe('GET');
    expect(init.headers['user-agent']).toMatch(/Kvorum/);
    expect(init.signal).toBeDefined();
  });

  it('trims a trailing slash from the base URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(categoryPage({ topicIds: [], moreTopicsUrl: null })));
    vi.stubGlobal('fetch', fetchMock);
    await client({ baseUrl: `${BASE}/` }).fetchCategoryPage('proposals', 9, 0, liveSignal());
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/c/proposals/9.json?page=0`);
  });

  it('tolerates a category page missing optional fields', async () => {
    // No topic_list.topics, no more_topics_url, and a topic lacking last_posted_at / tags.
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        topic_list: { topics: [{ id: 5, title: 'T', slug: 't', posts_count: 1, created_at: 'x' }] },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { topics, moreTopicsUrl } = await client().fetchCategoryPage('c', 1, 0, liveSignal());
    expect(moreTopicsUrl).toBeNull();
    expect(topics[0]).toMatchObject({ topicId: 5, lastActivityAt: null, tags: [] });
  });

  it('returns [] from a fully empty category body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const { topics, moreTopicsUrl } = await client().fetchCategoryPage('c', 1, 0, liveSignal());
    expect(topics).toEqual([]);
    expect(moreTopicsUrl).toBeNull();
  });

  it('fetchPosts short-circuits empty ids without a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().fetchPosts(1, [], liveSignal())).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('threads the abort signal into fetch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(categoryPage({ topicIds: [], moreTopicsUrl: null })));
    vi.stubGlobal('fetch', fetchMock);
    const signal = liveSignal();
    await client().fetchCategoryPage('proposals', 9, 0, signal);
    expect(fetchMock.mock.calls[0]![1].signal).toBe(signal);
  });
});

describe('DiscourseClient — retry / backoff', () => {
  it('retries a 5xx then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(categoryPage({ topicIds: [1], moreTopicsUrl: null })));
    vi.stubGlobal('fetch', fetchMock);
    const { topics } = await client().fetchCategoryPage('proposals', 9, 0, liveSignal());
    expect(topics).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('backs off on a 429 honouring Retry-After, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse(categoryPage({ topicIds: [2], moreTopicsUrl: null })));
    vi.stubGlobal('fetch', fetchMock);
    const { topics } = await client().fetchCategoryPage('proposals', 9, 0, liveSignal());
    expect(topics[0]!.topicId).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a transient network error then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse(categoryPage({ topicIds: [1], moreTopicsUrl: null })));
    vi.stubGlobal('fetch', fetchMock);
    await client().fetchCategoryPage('proposals', 9, 0, liveSignal());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting the retry budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      client({ maxRetries: 2 }).fetchCategoryPage('proposals', 9, 0, liveSignal()),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('backs off on a 429 without Retry-After (exponential), then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(categoryPage({ topicIds: [1], moreTopicsUrl: null })));
    vi.stubGlobal('fetch', fetchMock);
    await client().fetchCategoryPage('proposals', 9, 0, liveSignal());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws once the 429 backoff budget is exhausted', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '0' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      client({ maxRetries: 2 }).fetchCategoryPage('proposals', 9, 0, liveSignal()),
    ).rejects.toThrow(/retry budget exhausted/);
  });

  it('does not retry a non-429 4xx and surfaces the status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      client().fetchCategoryPage('proposals', 9, 0, liveSignal()),
    ).rejects.toBeInstanceOf(NonRetriableDiscourseError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Re-run to assert the carried status without the thrown reference.
    const fetchMock2 = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock2);
    await client()
      .fetchCategoryPage('proposals', 9, 0, liveSignal())
      .catch((err: unknown) => {
        expect((err as NonRetriableDiscourseError).status).toBe(404);
      });
  });

  it('does not retry once the per-tick signal is aborted', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort(new Error('tick-timeout'));
      return Promise.reject(new Error('aborted'));
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      client().fetchCategoryPage('proposals', 9, 0, controller.signal),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('DiscourseClient — iterateCategoryTopics', () => {
  it('pages 0-indexed until more_topics_url is absent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(categoryPage({ topicIds: [1, 2], moreTopicsUrl: '/c/proposals/9?page=1' })),
      )
      .mockResolvedValueOnce(jsonResponse(categoryPage({ topicIds: [3], moreTopicsUrl: null })));
    vi.stubGlobal('fetch', fetchMock);

    const ids: number[] = [];
    for await (const t of client().iterateCategoryTopics('proposals', 9, liveSignal()))
      ids.push(t.topicId);

    expect(ids).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls[0]![0]).toContain('page=0');
    expect(fetchMock.mock.calls[1]![0]).toContain('page=1');
  });

  it('stops on a degenerate empty page even if more_topics_url is set', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(categoryPage({ topicIds: [], moreTopicsUrl: '/c/proposals/9?page=1' })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const ids: number[] = [];
    for await (const t of client().iterateCategoryTopics('proposals', 9, liveSignal()))
      ids.push(t.topicId);
    expect(ids).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('DiscourseClient — fetchFullThread (defeats /t/{id}.json truncation)', () => {
  it('reassembles a 250-post thread in stream order across ≤20-id batches', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/posts.json')) {
        const ids = [...url.matchAll(/post_ids\[\]=(\d+)/g)].map((m) => Number(m[1]));
        return Promise.resolve(jsonResponse(postsResponse(ids)));
      }
      return Promise.resolve(jsonResponse(topicResponse({ topicId: 42, postCount: 250 })));
    });
    vi.stubGlobal('fetch', fetchMock);

    const thread = await client().fetchFullThread(42, liveSignal());

    expect(thread.posts).toHaveLength(250);
    expect(thread.posts.map((p) => p.id)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    // 1 topic request + ceil((250-20)/20)=12 posts requests.
    const postsCalls = fetchMock.mock.calls.filter((c) => (c[0] as string).includes('/posts.json'));
    expect(postsCalls).toHaveLength(12);
    // Every posts batch carries at most 20 ids.
    for (const [url] of postsCalls) {
      expect([...(url as string).matchAll(/post_ids\[\]=/g)].length).toBeLessThanOrEqual(20);
    }
  });

  it('uses the inline posts and makes no posts request for a short thread', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(topicResponse({ topicId: 7, postCount: 5 })));
    vi.stubGlobal('fetch', fetchMock);
    const thread = await client().fetchFullThread(7, liveSignal());
    expect(thread.posts).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty thread when post_stream is absent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ id: 9, title: 'Empty', posts_count: 0, created_at: 'x' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const thread = await client().fetchFullThread(9, liveSignal());
    expect(thread.posts).toEqual([]);
    expect(thread.lastActivityAt).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops stream ids the API never returns (deleted/hidden posts)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/posts.json')) {
        const ids = [...url.matchAll(/post_ids\[\]=(\d+)/g)].map((m) => Number(m[1]));
        return Promise.resolve(jsonResponse(postsResponse(ids, { omit: [25] })));
      }
      return Promise.resolve(jsonResponse(topicResponse({ topicId: 42, postCount: 30 })));
    });
    vi.stubGlobal('fetch', fetchMock);
    const thread = await client().fetchFullThread(42, liveSignal());
    expect(thread.posts).toHaveLength(29);
    expect(thread.posts.map((p) => p.id)).not.toContain(25);
  });
});
