import { describe, expect, it } from 'vitest';
import type { PollPollContext } from '@sources/core';
import { makeForumPollListener } from './poll-listener';
import type { ForumCursor, ForumThreadPayload } from './types';
import type { DiscourseClient } from '../client/client';
import type { DiscourseThread, DiscourseTopicSummary } from '../client/types';

const HOST = 'research.lido.fi';
const ctx = (): PollPollContext => ({ source: {} as never, signal: new AbortController().signal });

function topic(topicId: number, lastActivityAt: string | null): DiscourseTopicSummary {
  return {
    topicId,
    title: `T${topicId}`,
    slug: `t-${topicId}`,
    postCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt,
    tags: [],
  };
}

function thread(topicId: number, lastActivityAt: string | null): DiscourseThread {
  return {
    topicId,
    title: `T${topicId}`,
    postCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt,
    posts: [
      {
        id: topicId,
        username: 'u',
        createdAt: '2026-01-01T00:00:00.000Z',
        cooked: '<p>x</p>',
        postNumber: 1,
      },
    ],
  };
}

interface FakeSpec {
  categories?: { id: number; slug: string; name?: string | null }[];
  pages?: Record<string, { topics: DiscourseTopicSummary[]; moreTopicsUrl: string | null }>;
  threads?: Record<number, DiscourseThread>;
}

function fakeClient(spec: FakeSpec) {
  const calls = { categories: 0, pages: [] as string[], threads: [] as number[] };
  const client = {
    fetchCategories: () => {
      calls.categories += 1;
      return Promise.resolve(spec.categories ?? []);
    },
    fetchCategoryPage: (slug: string, id: number, page: number) => {
      calls.pages.push(`${slug}:${id}:${page}`);
      return Promise.resolve(spec.pages?.[`${id}:${page}`] ?? { topics: [], moreTopicsUrl: null });
    },
    fetchFullThread: (topicId: number) => {
      calls.threads.push(topicId);
      const t = spec.threads?.[topicId];
      if (t === undefined) throw new Error(`no thread ${topicId}`);
      return Promise.resolve(t);
    },
  };
  return { client: client as unknown as DiscourseClient, calls };
}

function baseCursor(over: Partial<ForumCursor>): ForumCursor {
  return {
    categories: [{ slug: 'proposals', id: 9 }],
    categoryIndex: 0,
    page: 0,
    pending: [],
    highWater: null,
    sweepMaxActivity: null,
    lastReconcileMs: 1_000_000,
    reconciling: false,
    ...over,
  };
}

describe('makeForumPollListener', () => {
  it('resolves categories once, then enumerates the first page and queues stale topics', async () => {
    const { client, calls } = fakeClient({
      categories: [
        { id: 9, slug: 'proposals' },
        { id: 1, slug: 'general' },
      ],
      pages: {
        '9:0': {
          topics: [topic(11, '2026-01-05T00:00:00Z'), topic(12, '2026-01-04T00:00:00Z')],
          moreTopicsUrl: '/c/p?page=1',
        },
      },
    });
    const listener = makeForumPollListener(
      { client, host: HOST, categorySlugs: ['proposals'] },
      1000,
    );

    const r = await listener.poll(ctx(), null);
    const cur = r.nextCursor as unknown as ForumCursor;

    expect(r.items).toEqual([]);
    expect(calls.categories).toBe(1);
    expect(calls.pages).toEqual(['proposals:9:0']);
    expect(cur.categories).toEqual([{ slug: 'proposals', id: 9 }]);
    expect(cur.pending.map((p) => p.topicId)).toEqual([11, 12]);
    expect(cur.page).toBe(1); // more pages → advance page, not category
  });

  it('does not re-fetch categories on later ticks', async () => {
    const { client, calls } = fakeClient({ categories: [{ id: 9, slug: 'proposals' }], pages: {} });
    const listener = makeForumPollListener(
      { client, host: HOST, categorySlugs: ['proposals'] },
      1000,
    );

    const first = await listener.poll(ctx(), null);
    await listener.poll(ctx(), first.nextCursor);
    expect(calls.categories).toBe(1);
  });

  it('drains pending threads bounded by maxThreadsPerTick and emits well-formed items', async () => {
    const { client, calls } = fakeClient({
      threads: { 1: thread(1, '2026-01-05T00:00:00Z'), 2: thread(2, null), 3: thread(3, null) },
    });
    const listener = makeForumPollListener(
      { client, host: HOST, categorySlugs: ['proposals'], maxThreadsPerTick: 2 },
      1000,
    );
    const start = baseCursor({
      pending: [
        { topicId: 1, lastActivityAt: null },
        { topicId: 2, lastActivityAt: null },
        { topicId: 3, lastActivityAt: null },
      ],
    });

    const r1 = await listener.poll(ctx(), start as unknown as never);
    expect(calls.threads).toEqual([1, 2]);
    expect(r1.items).toHaveLength(2);
    const item = r1.items[0]!;
    expect(item.externalId).toBe('topic:1');
    expect(item.eventType).toBe('DiscourseTopicCrawled');
    expect(item.ordinal).toBe('1');
    expect(item.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((item.payload as ForumThreadPayload).host).toBe(HOST);
    expect((item.payload as ForumThreadPayload).topicId).toBe(1);
    expect((r1.nextCursor as unknown as ForumCursor).pending.map((p) => p.topicId)).toEqual([3]);

    const r2 = await listener.poll(ctx(), r1.nextCursor);
    expect(r2.items.map((i) => i.externalId)).toEqual(['topic:3']);
  });

  it('incremental sweep skips topics at or below the high-water mark and promotes it on completion', async () => {
    const { client } = fakeClient({
      pages: {
        '9:0': {
          topics: [topic(11, '2026-01-05T00:00:00Z'), topic(12, '2026-01-03T00:00:00Z')],
          moreTopicsUrl: null,
        },
      },
    });
    const listener = makeForumPollListener(
      { client, host: HOST, categorySlugs: ['proposals'] },
      1000,
    );
    const start = baseCursor({ highWater: '2026-01-04T00:00:00Z' });

    const r = await listener.poll(ctx(), start as unknown as never);
    const cur = r.nextCursor as unknown as ForumCursor;

    // 12 is unchanged (<= high-water) → skipped; 11 is newer → queued.
    expect(cur.pending.map((p) => p.topicId)).toEqual([11]);
    // last page of the only category → sweep completes → high-water promoted to newest seen.
    expect(cur.highWater).toBe('2026-01-05T00:00:00Z');
    expect(cur.categoryIndex).toBe(0);
    expect(cur.page).toBe(0);
  });

  it('a reconcile sweep re-queues topics below the high-water mark', async () => {
    const { client } = fakeClient({
      pages: { '9:0': { topics: [topic(11, '2026-01-01T00:00:00Z')], moreTopicsUrl: null } },
    });
    const listener = makeForumPollListener(
      { client, host: HOST, categorySlugs: ['proposals'] },
      1000,
    );
    const start = baseCursor({ highWater: '2026-01-10T00:00:00Z', reconciling: true });

    const r = await listener.poll(ctx(), start as unknown as never);
    // Despite being far below high-water, the topic is re-crawled while reconciling.
    expect((r.nextCursor as unknown as ForumCursor).pending.map((p) => p.topicId)).toEqual([11]);
  });

  it('flips the next sweep to reconcile once the reconcile interval elapses', async () => {
    const t = 100_000_000;
    const { client } = fakeClient({
      pages: { '9:0': { topics: [], moreTopicsUrl: null } },
    });
    const listener = makeForumPollListener(
      { client, host: HOST, categorySlugs: ['proposals'], reconcileIntervalMs: 1000, now: () => t },
      1000,
    );
    // A completed incremental sweep whose last reconcile is well in the past → next sweep reconciles.
    const start = baseCursor({ lastReconcileMs: t - 5000, reconciling: false });
    const r = await listener.poll(ctx(), start as unknown as never);
    expect((r.nextCursor as unknown as ForumCursor).reconciling).toBe(true);
  });

  it('advances to the next category when a category is exhausted before the last', async () => {
    const { client, calls } = fakeClient({
      categories: [
        { id: 9, slug: 'proposals' },
        { id: 1, slug: 'general' },
      ],
      pages: { '9:0': { topics: [], moreTopicsUrl: null } },
    });
    const listener = makeForumPollListener(
      { client, host: HOST, categorySlugs: ['proposals', 'general'] },
      1000,
    );
    const r = await listener.poll(ctx(), null);
    const cur = r.nextCursor as unknown as ForumCursor;
    expect(cur.categoryIndex).toBe(1);
    expect(cur.page).toBe(0);
    expect(calls.pages).toEqual(['proposals:9:0']);
  });

  it('crawls nothing when no configured slug resolves to a live category', async () => {
    const { client, calls } = fakeClient({ categories: [{ id: 9, slug: 'proposals' }] });
    const listener = makeForumPollListener(
      { client, host: HOST, categorySlugs: ['does-not-exist'] },
      1000,
    );

    const r = await listener.poll(ctx(), null);
    expect(r.items).toEqual([]);
    expect((r.nextCursor as unknown as ForumCursor).categories).toEqual([]);
    expect(calls.pages).toEqual([]); // never enumerated

    // A later tick with the persisted empty-categories cursor still does nothing.
    const r2 = await listener.poll(ctx(), r.nextCursor);
    expect(r2.items).toEqual([]);
    expect(calls.pages).toEqual([]);
  });
});
