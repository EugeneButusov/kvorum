import type { JsonValue } from '@libs/domain';
import type { PollItem, PollListener, PollPollContext, PollResult } from '@sources/core';
import type { DiscourseClient } from '../client/client';
import type { DiscourseThread, DiscourseTopicSummary } from '../client/types';
import { forumMetrics } from '../metrics';
import { contentHash } from './content-hash';
import type { ForumCursor, ForumThreadPayload, PendingTopic, ResolvedCategory } from './types';

export const DEFAULT_MAX_THREADS_PER_TICK = 5;
export const DEFAULT_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

export interface ForumPollListenerDeps {
  client: DiscourseClient;
  host: string;
  /** Configured Discourse category slugs to crawl. */
  categorySlugs: readonly string[];
  /** Full threads fetched (and emitted) per tick. Keeps a tick under the poll deadline. */
  maxThreadsPerTick?: number;
  /** A completed sweep older than this triggers a reconcile (watermark-ignoring) sweep. */
  reconcileIntervalMs?: number;
  /** Injected clock (ms). Defaults to Date.now (overridable in tests). */
  now?: () => number;
}

function initialCursor(): ForumCursor {
  return {
    categories: null,
    categoryIndex: 0,
    page: 0,
    pending: [],
    highWater: null,
    sweepMaxActivity: null,
    lastReconcileMs: 0,
    reconciling: false,
  };
}

/** Resolve configured slugs against the live category list, preserving config order. Unknown slugs
 *  are dropped (logged via metric by the caller); ISO ids are numeric. */
function resolveCategories(
  slugs: readonly string[],
  live: readonly { slug: string; id: number }[],
): ResolvedCategory[] {
  const bySlug = new Map(live.map((c) => [c.slug, c.id]));
  const resolved: ResolvedCategory[] = [];
  for (const slug of slugs) {
    const id = bySlug.get(slug);
    if (id !== undefined) resolved.push({ slug, id });
  }
  return resolved;
}

/** A topic is worth a full-thread fetch when reconciling, or when its activity is newer than the
 *  last completed sweep's high-water (ISO-8601 UTC strings sort lexically = chronologically). */
function isTopicStale(
  topic: DiscourseTopicSummary,
  highWater: string | null,
  reconciling: boolean,
): boolean {
  if (reconciling || highWater === null) return true;
  if (topic.lastActivityAt === null) return true;
  return topic.lastActivityAt > highWater;
}

function maxActivity(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

function toItem(host: string, thread: DiscourseThread): PollItem {
  const payload: ForumThreadPayload = {
    host,
    topicId: thread.topicId,
    title: thread.title,
    postCount: thread.postCount,
    createdAt: thread.createdAt,
    lastActivityAt: thread.lastActivityAt,
    posts: thread.posts,
  };
  return {
    // Namespaced so the id space is unambiguous within archive_event_discourse_forum, keyed on
    // (dao_source_id, external_id). The deriver strips the prefix; topicId stays in the payload.
    externalId: `topic:${thread.topicId}`,
    eventType: 'DiscourseTopicCrawled',
    contentHash: contentHash(payload),
    // Topic id is a stable, source-native, monotonic-enough ordinal (parses as bigint).
    ordinal: String(thread.topicId),
    payload,
  };
}

/**
 * PollListener for one Discourse host. Each tick does ONE bounded unit of work so it always finishes
 * within the poll deadline:
 *   1. resolve category slugs→ids once (first tick),
 *   2. if topics are pending, fetch up to `maxThreadsPerTick` full threads and emit them,
 *   3. otherwise enumerate one category page, queueing stale topics and advancing the sweep.
 *
 * On completing a full sweep it promotes the high-water mark and, once the reconcile interval has
 * elapsed, flips the next sweep into reconcile mode (re-crawl everything to catch silent edits).
 * Cursor persistence + enqueue are owned by the generic off-chain poll driver.
 */
export function makeForumPollListener(
  deps: ForumPollListenerDeps,
  intervalMs: number,
): PollListener<JsonValue> {
  const { client, host } = deps;
  const maxThreads = deps.maxThreadsPerTick ?? DEFAULT_MAX_THREADS_PER_TICK;
  const reconcileIntervalMs = deps.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
  const now = deps.now ?? Date.now;

  return {
    intervalMs,
    async poll(ctx: PollPollContext, cursor: JsonValue | null): Promise<PollResult<JsonValue>> {
      const cur = (cursor as ForumCursor | null) ?? initialCursor();

      // Anchor the reconcile clock on the first-ever tick so the first (already full) sweep isn't
      // immediately followed by a redundant reconcile sweep.
      if (cur.lastReconcileMs === 0) cur.lastReconcileMs = now();

      // 1. Resolve categories once (slug → numeric id via /categories.json).
      if (cur.categories === null) {
        const live = await client.fetchCategories(ctx.signal);
        cur.categories = resolveCategories(deps.categorySlugs, live);
      }
      if (cur.categories.length === 0) {
        // Misconfigured host (no configured slug matched); nothing to crawl.
        return { items: [], nextCursor: cur as unknown as JsonValue };
      }

      // 2. Drain pending threads (bounded).
      if (cur.pending.length > 0) {
        const batch = cur.pending.slice(0, maxThreads);
        const rest = cur.pending.slice(maxThreads);
        const items: PollItem[] = [];
        for (const topic of batch) {
          const thread = await client.fetchFullThread(topic.topicId, ctx.signal);
          items.push(toItem(host, thread));
        }
        forumMetrics.threadsCrawled.add(items.length, { forum_host: host });
        return { items, nextCursor: { ...cur, pending: rest } as unknown as JsonValue };
      }

      // 3. Enumerate one category page.
      const category = cur.categories[cur.categoryIndex]!;
      const { topics, moreTopicsUrl } = await client.fetchCategoryPage(
        category.slug,
        category.id,
        cur.page,
        ctx.signal,
      );
      forumMetrics.topicsEnumerated.add(topics.length, { forum_host: host });

      const pending: PendingTopic[] = [];
      let sweepMax = cur.sweepMaxActivity;
      for (const topic of topics) {
        sweepMax = maxActivity(sweepMax, topic.lastActivityAt);
        if (isTopicStale(topic, cur.highWater, cur.reconciling)) {
          pending.push({ topicId: topic.topicId, lastActivityAt: topic.lastActivityAt });
        }
      }

      const next = advanceEnumeration(
        { ...cur, sweepMaxActivity: sweepMax, pending },
        moreTopicsUrl,
        cur.categories.length,
        now(),
        reconcileIntervalMs,
        host,
      );
      return { items: [], nextCursor: next as unknown as JsonValue };
    },
  };
}

/** Move the enumeration position forward one page/category, and — when the last page of the last
 *  category is reached — close the sweep: promote the high-water mark, reset to the first category,
 *  and decide whether the next sweep reconciles. */
function advanceEnumeration(
  cur: ForumCursor,
  moreTopicsUrl: string | null,
  categoriesLen: number,
  nowMs: number,
  reconcileIntervalMs: number,
  host: string,
): ForumCursor {
  const morePagesInCategory = moreTopicsUrl != null && cur.page >= 0;
  if (morePagesInCategory) {
    return { ...cur, page: cur.page + 1 };
  }

  const isLastCategory = cur.categoryIndex >= categoriesLen - 1;
  if (!isLastCategory) {
    return { ...cur, categoryIndex: cur.categoryIndex + 1, page: 0 };
  }

  // Sweep complete: promote the high-water mark and reset enumeration for the next sweep.
  forumMetrics.sweepsCompleted.add(1, {
    forum_host: host,
    mode: cur.reconciling ? 'reconcile' : 'incremental',
  });
  const highWater = maxActivity(cur.highWater, cur.sweepMaxActivity);
  const lastReconcileMs = cur.reconciling ? nowMs : cur.lastReconcileMs;
  const nextReconciling = nowMs - lastReconcileMs >= reconcileIntervalMs;
  return {
    ...cur,
    categoryIndex: 0,
    page: 0,
    highWater,
    sweepMaxActivity: null,
    lastReconcileMs,
    reconciling: nextReconciling,
  };
}
