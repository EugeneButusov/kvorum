import type {
  DiscourseCategoryPageResponse,
  DiscoursePostRaw,
  DiscoursePostsResponse,
  DiscourseTopicResponse,
} from '../../src/client/types';

/** A category page shaped like research.lido.fi's `/c/proposals/9.json` (fields we read only). */
export function categoryPage(opts: {
  topicIds: number[];
  moreTopicsUrl: string | null;
}): DiscourseCategoryPageResponse {
  return {
    topic_list: {
      more_topics_url: opts.moreTopicsUrl,
      topics: opts.topicIds.map((id) => ({
        id,
        title: `Proposal ${id}`,
        slug: `proposal-${id}`,
        posts_count: 3,
        created_at: '2026-01-01T00:00:00.000Z',
        last_posted_at: '2026-01-02T00:00:00.000Z',
        category_id: 9,
        tags: ['proposal'],
      })),
    },
  };
}

function post(id: number): DiscoursePostRaw {
  return {
    id,
    username: `user${id}`,
    created_at: `2026-01-01T00:${String(id % 60).padStart(2, '0')}:00.000Z`,
    cooked: `<p>post ${id}</p>`,
    post_number: id,
  };
}

/**
 * A topic response whose `post_stream.stream` lists `postCount` ids but whose inline `posts` only
 * carries the first `inlineCount` (default 20) — exactly Discourse's truncation behaviour. The
 * client must walk the rest via the posts endpoint.
 */
export function topicResponse(opts: {
  topicId: number;
  postCount: number;
  inlineCount?: number;
}): DiscourseTopicResponse {
  const inlineCount = opts.inlineCount ?? 20;
  const stream = Array.from({ length: opts.postCount }, (_, i) => i + 1);
  const inline = stream.slice(0, inlineCount).map(post);
  return {
    id: opts.topicId,
    title: `Topic ${opts.topicId}`,
    posts_count: opts.postCount,
    created_at: '2026-01-01T00:00:00.000Z',
    last_posted_at: '2026-01-03T00:00:00.000Z',
    post_stream: { posts: inline, stream },
  };
}

/** The `/t/{id}/posts.json` reply for a batch of ids. Omitting an id models a deleted/hidden post. */
export function postsResponse(ids: number[], opts?: { omit?: number[] }): DiscoursePostsResponse {
  const omit = new Set(opts?.omit ?? []);
  return { post_stream: { posts: ids.filter((id) => !omit.has(id)).map(post) } };
}

/** A `fetch` mock that serves a JSON body with status 200. */
export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
