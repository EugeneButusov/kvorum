import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@libs/chain';
import type {
  ArchiveDerivationRepository,
  DaoSourceRepository,
  OffchainArchiveRow,
  PgDatabase,
} from '@libs/db';
import {
  ForumThreadProjectionApplier,
  type ForumProjectionRepos,
} from './thread-projection-applier';
import type { ForumThreadPayload } from '../ingestion/types';
import type { ForumArchivePayloadRepository } from '../persistence/archive-payload-repository';
import type { ForumLinkRepository } from '../persistence/forum-link-repository';

function row(id: string, externalId: string): OffchainArchiveRow {
  return {
    id,
    source_type: 'discourse_forum',
    dao_source_id: 'dao-source-1',
    chain_id: 'off-chain',
    external_id: externalId,
    derivation_ordinal: '10',
    event_type: 'DiscourseTopicCrawled',
    received_at: new Date('2026-01-01T00:00:00Z'),
    derivation_attempt_count: 0,
  };
}

function payload(topicId: number): ForumThreadPayload {
  return {
    host: 'research.lido.fi',
    topicId,
    title: `T${topicId}`,
    postCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-05T00:00:00.000Z',
    posts: [
      {
        id: 1,
        username: 'alice',
        createdAt: '2026-01-01T00:00:00.000Z',
        cooked: '<p>hi</p>',
        postNumber: 1,
      },
    ],
  };
}

function harness(opts: {
  payloadsByExternalId: Record<string, string>;
  daoId?: string | undefined;
  inserted?: boolean;
}) {
  const upsert = vi.fn().mockResolvedValue({ inserted: opts.inserted ?? true });
  const markDerived = vi.fn().mockResolvedValue(undefined);
  const incrementAttemptCount = vi.fn().mockResolvedValue(undefined);
  const resetScanForUnlinkedProposals = vi.fn().mockResolvedValue(0);
  const error = vi.fn();

  const payloads = {
    fetchLatest: (rows: readonly OffchainArchiveRow[]) =>
      Promise.resolve(
        rows
          .filter((r) => opts.payloadsByExternalId[r.external_id] !== undefined)
          .map((r) => ({
            external_id: r.external_id,
            payload: opts.payloadsByExternalId[r.external_id]!,
          })),
      ),
  } as unknown as ForumArchivePayloadRepository;

  const daoSources = {
    findDaoIdForSource: () => Promise.resolve(opts.daoId === undefined ? undefined : opts.daoId),
  } as unknown as DaoSourceRepository;

  const archive = { incrementAttemptCount } as unknown as ArchiveDerivationRepository;

  const applier = new ForumThreadProjectionApplier({
    pgDb: {} as unknown as Kysely<PgDatabase>,
    payloads,
    archive,
    daoSources,
    linkRepo: { resetScanForUnlinkedProposals } as unknown as ForumLinkRepository,
    logger: { error } as unknown as Logger,
    withTransaction: (fn) =>
      fn({
        forumThreads: { upsert },
        archive: { markDerived },
      } as unknown as ForumProjectionRepos),
  });

  return {
    applier,
    upsert,
    markDerived,
    incrementAttemptCount,
    resetScanForUnlinkedProposals,
    error,
  };
}

describe('ForumThreadProjectionApplier.applyBatch', () => {
  it('renders the latest payload and upserts forum_thread, then marks the row derived', async () => {
    const h = harness({
      payloadsByExternalId: { 'topic:10': JSON.stringify(payload(10)) },
      daoId: 'dao-1',
    });

    await h.applier.applyBatch([row('r1', 'topic:10')]);

    expect(h.upsert).toHaveBeenCalledTimes(1);
    const arg = h.upsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.daoId).toBe('dao-1');
    expect(arg.forumHost).toBe('research.lido.fi');
    expect(arg.forumTopicId).toBe('10');
    expect(arg.title).toBe('T10');
    expect(arg.postCount).toBe(2);
    expect(arg.lastActivityAt).toEqual(new Date('2026-01-05T00:00:00.000Z'));
    expect(arg.rawContent).toContain('**@alice**');
    expect(arg.rawContent).toContain('hi');
    expect(arg.contentPipelineVersion).toMatch(/^turndown@/);
    expect(h.markDerived).toHaveBeenCalledWith('r1');
    expect(h.incrementAttemptCount).not.toHaveBeenCalled();
    // A NEW thread re-queues the DAO's unlinked proposals for the linker sweep.
    expect(h.resetScanForUnlinkedProposals).toHaveBeenCalledWith('dao-1');
  });

  it('does not re-queue linking when the thread already existed (update, not insert)', async () => {
    const h = harness({
      payloadsByExternalId: { 'topic:10': JSON.stringify(payload(10)) },
      daoId: 'dao-1',
      inserted: false,
    });
    await h.applier.applyBatch([row('r1', 'topic:10')]);
    expect(h.markDerived).toHaveBeenCalledWith('r1');
    expect(h.resetScanForUnlinkedProposals).not.toHaveBeenCalled();
  });

  it('a re-queue failure never fails derivation', async () => {
    const h = harness({
      payloadsByExternalId: { 'topic:10': JSON.stringify(payload(10)) },
      daoId: 'dao-1',
    });
    h.resetScanForUnlinkedProposals.mockRejectedValueOnce(new Error('db down'));
    await expect(h.applier.applyBatch([row('r1', 'topic:10')])).resolves.toBeUndefined();
    expect(h.markDerived).toHaveBeenCalledWith('r1'); // derivation still succeeded
    expect(h.error).toHaveBeenCalled();
  });

  it('carries a null last_activity through as null', async () => {
    const p = { ...payload(11), lastActivityAt: null };
    const h = harness({ payloadsByExternalId: { 'topic:11': JSON.stringify(p) }, daoId: 'dao-1' });
    await h.applier.applyBatch([row('r2', 'topic:11')]);
    expect((h.upsert.mock.calls[0]![0] as Record<string, unknown>).lastActivityAt).toBeNull();
  });

  it('fails the row (increment + log, no upsert) when the archive payload is missing', async () => {
    const h = harness({ payloadsByExternalId: {}, daoId: 'dao-1' });
    await h.applier.applyBatch([row('r3', 'topic:12')]);
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.markDerived).not.toHaveBeenCalled();
    expect(h.incrementAttemptCount).toHaveBeenCalledWith('r3');
    expect(h.error).toHaveBeenCalled();
  });

  it('fails the row when the dao_source cannot be resolved', async () => {
    const h = harness({
      payloadsByExternalId: { 'topic:13': JSON.stringify(payload(13)) },
      daoId: undefined,
    });
    await h.applier.applyBatch([row('r4', 'topic:13')]);
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.incrementAttemptCount).toHaveBeenCalledWith('r4');
  });

  it('fails the row on undecodable JSON', async () => {
    const h = harness({ payloadsByExternalId: { 'topic:14': '{not json' }, daoId: 'dao-1' });
    await h.applier.applyBatch([row('r5', 'topic:14')]);
    expect(h.incrementAttemptCount).toHaveBeenCalledWith('r5');
    expect(h.error).toHaveBeenCalled();
  });

  it('is a no-op on an empty batch', async () => {
    const h = harness({ payloadsByExternalId: {}, daoId: 'dao-1' });
    await h.applier.applyBatch([]);
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.incrementAttemptCount).not.toHaveBeenCalled();
  });
});
