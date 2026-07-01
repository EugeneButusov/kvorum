import { defineCounter, defineHistogram } from '@libs/observability';

// `indexer_forum_*` once the service prefix is applied (ADR-045). These cover the Discourse
// client + turndown pipeline; the crawl worker will add thread/link-level families later.
export const forumMetrics = {
  httpLatency: defineHistogram({
    name: 'forum_http_latency_ms',
    description: 'Discourse HTTP request latency in ms, by endpoint (category|topic|posts)',
    buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10_000],
  }),
  httpErrors: defineCounter({
    name: 'forum_http_errors',
    description: 'Discourse HTTP request failures after retries, by endpoint',
  }),
  rateLimited: defineCounter({
    name: 'forum_rate_limited',
    description: 'Discourse 429 responses that triggered a backoff, by endpoint',
  }),
  postPaginationDepth: defineHistogram({
    name: 'forum_post_pagination_depth',
    description: 'Number of /posts.json requests made to walk one thread’s post_stream',
    buckets: [1, 2, 5, 10, 20, 50, 100],
  }),
  turndownFailures: defineCounter({
    name: 'forum_turndown_failures',
    description: 'Posts whose cooked HTML failed to normalise to Markdown, by forum_host',
  }),
  topicsEnumerated: defineCounter({
    name: 'forum_topics_enumerated',
    description: 'Category-listing topics seen by a crawl tick, by forum_host',
  }),
  threadsCrawled: defineCounter({
    name: 'forum_threads_crawled',
    description: 'Full threads fetched + emitted by a crawl tick, by forum_host',
  }),
  sweepsCompleted: defineCounter({
    name: 'forum_sweeps_completed',
    description: 'Completed category sweeps, by forum_host and mode (incremental|reconcile)',
  }),
  threadsDerived: defineCounter({
    name: 'forum_threads_derived',
    description: 'forum_thread derivations by outcome (derived|failed)',
  }),
};

export type ForumEndpoint = 'categories' | 'category' | 'topic' | 'posts';
