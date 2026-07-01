import { forumMetrics, type ForumEndpoint } from '../metrics';
import { abortableDelay } from './abortable-delay';
import { RatePacer, type RatePacerOptions } from './rate-pacer';
import type {
  DiscourseCategoryPageResponse,
  DiscoursePost,
  DiscoursePostRaw,
  DiscoursePostsResponse,
  DiscourseThread,
  DiscourseTopicResponse,
  DiscourseTopicSummary,
} from './types';

/** Discourse caps `post_ids[]` at 20 per request; walk `post_stream.stream` in chunks this size. */
export const POST_IDS_CHUNK_SIZE = 20;

/** Discourse rejects requests without a real User-Agent (returns 403/429); identify the crawler. */
export const DEFAULT_USER_AGENT = 'KvorumForumCrawler/1.0 (+https://kvorum.watch)';

export interface DiscourseClientOptions {
  /** Forum host base URL, e.g. `https://research.lido.fi`. Trailing slash is trimmed. */
  baseUrl: string;
  /** User-Agent header — Discourse is UA-sensitive. Defaults to DEFAULT_USER_AGENT. */
  userAgent?: string;
  /** Retry attempts on 5xx / network / 429 before giving up. Default 4. */
  maxRetries?: number;
  /** Base backoff in ms; doubles per attempt. Default 500. */
  backoffBaseMs?: number;
  /** Post-ids chunk size for the thread walk. Default 20 (the Discourse cap). */
  chunkSize?: number;
  /** Rate-pacer tuning (defaults to Discourse's 50/10s + 200/min). */
  pacer?: RatePacerOptions;
}

/** A permanent failure (a 4xx other than 429) — retrying won't help. Carries the HTTP status so
 *  the crawl worker can special-case e.g. a 404 deleted topic. */
export class NonRetriableDiscourseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'NonRetriableDiscourseError';
  }
}

/** Discourse client for ONE forum host. All requests pass through a per-host rate pacer and a
 *  429/5xx/network retry loop; `ctx.signal` is threaded into every fetch and every wait so a
 *  per-tick deadline cancels cleanly (ADR-071). Structurally mirrors SnapshotClient. */
export class DiscourseClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly chunkSize: number;
  private readonly pacer: RatePacer;

  constructor(opts: DiscourseClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.maxRetries = opts.maxRetries ?? 4;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.chunkSize = opts.chunkSize ?? POST_IDS_CHUNK_SIZE;
    this.pacer = new RatePacer(opts.pacer);
  }

  /** Fetch one category page (`/c/{slug}/{id}.json?page=N`, page 0-indexed). Returns the topics
   *  and `moreTopicsUrl` (null on the last page — the caller's stop signal). */
  async fetchCategoryPage(
    slug: string,
    categoryId: number,
    page: number,
    signal: AbortSignal,
  ): Promise<{ topics: DiscourseTopicSummary[]; moreTopicsUrl: string | null }> {
    const path = `/c/${encodeURIComponent(slug)}/${categoryId}.json?page=${page}`;
    const body = await this.request<DiscourseCategoryPageResponse>(path, 'category', signal);
    const topics = (body.topic_list?.topics ?? []).map(
      (t): DiscourseTopicSummary => ({
        topicId: t.id,
        title: t.title,
        slug: t.slug,
        postCount: t.posts_count,
        createdAt: t.created_at,
        lastActivityAt: t.last_posted_at ?? null,
        tags: t.tags ?? [],
      }),
    );
    return { topics, moreTopicsUrl: body.topic_list?.more_topics_url ?? null };
  }

  /** Async-iterate every topic in a category, paging 0-indexed until `more_topics_url` is absent. */
  async *iterateCategoryTopics(
    slug: string,
    categoryId: number,
    signal: AbortSignal,
  ): AsyncGenerator<DiscourseTopicSummary> {
    for (let page = 0; ; page += 1) {
      const { topics, moreTopicsUrl } = await this.fetchCategoryPage(
        slug,
        categoryId,
        page,
        signal,
      );
      for (const topic of topics) yield topic;
      // Stop on the last page OR a degenerate empty page (guards against a never-clearing cursor).
      if (moreTopicsUrl == null || topics.length === 0) return;
    }
  }

  /** Fetch a topic's metadata + the full ordered post-id `stream` + the first ~20 inline posts. */
  private async fetchTopicRaw(
    topicId: number,
    signal: AbortSignal,
  ): Promise<DiscourseTopicResponse> {
    return this.request<DiscourseTopicResponse>(`/t/${topicId}.json`, 'topic', signal);
  }

  /** Fetch a specific batch of posts (`/t/{id}/posts.json?post_ids[]=…`, ≤20 ids). */
  async fetchPosts(
    topicId: number,
    postIds: readonly number[],
    signal: AbortSignal,
  ): Promise<DiscoursePost[]> {
    if (postIds.length === 0) return [];
    const query = postIds.map((id) => `post_ids[]=${id}`).join('&');
    const body = await this.request<DiscoursePostsResponse>(
      `/t/${topicId}/posts.json?${query}`,
      'posts',
      signal,
    );
    return (body.post_stream?.posts ?? []).map(toPost);
  }

  /** Assemble a complete thread: read the topic's `stream`, reuse the inline first posts, fetch the
   *  remaining ids in ≤chunkSize batches, and return every post in stream order. This defeats the
   *  ~20-post truncation of `/t/{id}.json`. */
  async fetchFullThread(topicId: number, signal: AbortSignal): Promise<DiscourseThread> {
    const topic = await this.fetchTopicRaw(topicId, signal);
    const stream = topic.post_stream?.stream ?? [];

    const byId = new Map<number, DiscoursePost>();
    for (const raw of topic.post_stream?.posts ?? []) byId.set(raw.id, toPost(raw));

    const missing = stream.filter((id) => !byId.has(id));
    let requests = 0;
    for (let i = 0; i < missing.length; i += this.chunkSize) {
      const chunk = missing.slice(i, i + this.chunkSize);
      const posts = await this.fetchPosts(topicId, chunk, signal);
      requests += 1;
      for (const post of posts) byId.set(post.id, post);
    }
    forumMetrics.postPaginationDepth.record(requests);

    // Emit in stream order; drop ids the API never returned (e.g. a deleted/hidden post).
    const posts: DiscoursePost[] = [];
    for (const id of stream) {
      const post = byId.get(id);
      if (post !== undefined) posts.push(post);
    }

    return {
      topicId: topic.id,
      title: topic.title,
      postCount: topic.posts_count,
      createdAt: topic.created_at,
      lastActivityAt: topic.last_posted_at ?? null,
      posts,
    };
  }

  private async request<T>(path: string, endpoint: ForumEndpoint, signal: AbortSignal): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'user-agent': this.userAgent,
      accept: 'application/json',
    };

    let attempt = 0;
    for (;;) {
      await this.pacer.acquire(signal);
      const start = Date.now();
      try {
        const res = await fetch(url, { method: 'GET', headers, signal });
        forumMetrics.httpLatency.record(Date.now() - start, { endpoint });

        if (res.status === 429) {
          forumMetrics.rateLimited.add(1, { endpoint });
          await this.backoff(attempt, res.headers.get('retry-after'), signal, endpoint);
          attempt += 1;
          continue;
        }
        if (res.status >= 500) {
          await this.backoff(attempt, null, signal, endpoint);
          attempt += 1;
          continue;
        }
        if (!res.ok) {
          // 4xx (other than 429) is a client error — don't retry.
          forumMetrics.httpErrors.add(1, { endpoint });
          throw new NonRetriableDiscourseError(
            `Discourse ${endpoint} HTTP ${res.status}`,
            res.status,
          );
        }

        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof NonRetriableDiscourseError) throw err;
        if (signal.aborted) throw err;
        if (attempt >= this.maxRetries) {
          forumMetrics.httpErrors.add(1, { endpoint });
          throw err;
        }
        await abortableDelay(this.backoffMs(attempt), signal);
        attempt += 1;
      }
    }
  }

  /** Honour Retry-After (integer seconds) when present, else exponential backoff. Throws once the
   *  attempt budget is exhausted so the caller fails the tick (cursor not advanced). */
  private async backoff(
    attempt: number,
    retryAfter: string | null,
    signal: AbortSignal,
    endpoint: ForumEndpoint,
  ): Promise<void> {
    if (attempt >= this.maxRetries) {
      forumMetrics.httpErrors.add(1, { endpoint });
      throw new Error(`Discourse ${endpoint} retry budget exhausted`);
    }
    const retryAfterMs = retryAfter != null ? Number(retryAfter) * 1000 : NaN;
    const waitMs = Number.isFinite(retryAfterMs) ? retryAfterMs : this.backoffMs(attempt);
    await abortableDelay(waitMs, signal);
  }

  private backoffMs(attempt: number): number {
    return this.backoffBaseMs * 2 ** attempt;
  }
}

function toPost(raw: DiscoursePostRaw): DiscoursePost {
  return {
    id: raw.id,
    username: raw.username,
    createdAt: raw.created_at,
    cooked: raw.cooked,
    postNumber: raw.post_number,
  };
}
