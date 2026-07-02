import type { Kysely } from 'kysely';
import type { Logger } from '@libs/chain';
import {
  ArchiveDerivationRepository,
  DaoSourceRepository,
  type OffchainArchiveRow,
  type PgDatabase,
} from '@libs/db';
import type { OffchainProjectionDeriver } from '@sources/core';
import { renderThread } from '../content/content-pipeline';
import type { ForumThreadPayload } from '../ingestion/types';
import { forumMetrics } from '../metrics';
import type { ForumArchivePayloadRepository } from '../persistence/archive-payload-repository';
import type { ForumLinkRepository } from '../persistence/forum-link-repository';
import { ForumThreadRepository } from '../persistence/forum-thread-repository';

/** Repositories an apply runs against, all bound to the same transaction in production. */
export interface ForumProjectionRepos {
  forumThreads: ForumThreadRepository;
  archive: ArchiveDerivationRepository;
}

export type ForumTransactionRunner = (
  fn: (repos: ForumProjectionRepos) => Promise<void>,
) => Promise<void>;

export interface ForumThreadProjectionApplierDeps {
  pgDb: Kysely<PgDatabase>;
  payloads: ForumArchivePayloadRepository;
  /** Non-transactional repo for the failure path (attempt increment outside the tx). */
  archive: ArchiveDerivationRepository;
  daoSources: DaoSourceRepository;
  logger: Logger;
  /** Optional: on inserting a NEW thread, re-queue the DAO's unlinked proposals for the linker
   *  sweep (best-effort, never blocks derivation). Omitted → no re-queue. */
  linkRepo?: ForumLinkRepository;
  /** Override the per-row transaction runner (tests inject mock repos). */
  withTransaction?: ForumTransactionRunner;
}

function defaultTransactionRunner(pgDb: Kysely<PgDatabase>): ForumTransactionRunner {
  return (fn) =>
    pgDb.transaction().execute((tx) =>
      fn({
        forumThreads: new ForumThreadRepository(tx),
        archive: new ArchiveDerivationRepository(tx),
      }),
    );
}

/** Derives archived Discourse threads into `forum_thread`. Off-chain mutable-latest: an edit
 *  re-derives the same (forum_host, forum_topic_id) row (the consumer reset `derived_at`), rendering
 *  the latest payload to Markdown via the pinned ADR-034 pipeline and upserting the content. */
export class ForumThreadProjectionApplier implements OffchainProjectionDeriver {
  readonly kind = 'offchain-projection' as const;
  readonly sourceTypes = ['discourse_forum'] as const;
  readonly eventTypes = ['DiscourseTopicCrawled'] as const;

  private readonly withTransaction: ForumTransactionRunner;

  constructor(private readonly deps: ForumThreadProjectionApplierDeps) {
    this.withTransaction = deps.withTransaction ?? defaultTransactionRunner(deps.pgDb);
  }

  async applyBatch(rows: readonly OffchainArchiveRow[]): Promise<void> {
    if (rows.length === 0) return;
    const payloads = await this.deps.payloads.fetchLatest(rows);
    const byExternalId = new Map(payloads.map((row) => [row.external_id, row.payload]));

    for (const row of rows) {
      const payloadJson = byExternalId.get(row.external_id);
      if (payloadJson === undefined) {
        await this.fail(row, 'payload_missing', new Error('archive payload missing'));
        continue;
      }

      let payload: ForumThreadPayload;
      try {
        payload = JSON.parse(payloadJson) as ForumThreadPayload;
      } catch (err) {
        await this.fail(row, 'decode_error', err);
        continue;
      }

      try {
        const daoId = await this.deps.daoSources.findDaoIdForSource(row.dao_source_id);
        if (daoId === undefined) throw new Error(`unknown dao_source ${row.dao_source_id}`);
        const rendered = renderThread(payload, payload.host);
        let inserted = false;
        await this.withTransaction(async (repos) => {
          const upsertResult = await repos.forumThreads.upsert({
            daoId,
            forumHost: payload.host,
            forumTopicId: String(payload.topicId),
            title: payload.title,
            rawContent: rendered.rawContent,
            contentPipelineVersion: rendered.contentPipelineVersion,
            postCount: payload.postCount,
            lastActivityAt: payload.lastActivityAt ? new Date(payload.lastActivityAt) : null,
          });
          inserted = upsertResult.inserted;
          await repos.archive.markDerived(row.id);
        });
        forumMetrics.threadsDerived.add(1, { outcome: 'derived' });
        if (inserted) await this.requeueForLinking(daoId);
      } catch (err) {
        await this.fail(row, 'projection_apply_error', err);
      }
    }
  }

  /** Best-effort re-queue after a NEW thread lands, so the DAO's unlinked proposals are re-evaluated
   *  against it by the linker sweep. Never throws — linking must not block ingestion. */
  private async requeueForLinking(daoId: string): Promise<void> {
    if (this.deps.linkRepo === undefined) return;
    try {
      await this.deps.linkRepo.resetScanForUnlinkedProposals(daoId);
    } catch (err) {
      this.deps.logger.error('forum_link_requeue_failed', { dao_id: daoId, error: String(err) });
    }
  }

  private async fail(row: OffchainArchiveRow, reason: string, error: unknown): Promise<void> {
    await this.deps.archive.incrementAttemptCount(row.id);
    forumMetrics.threadsDerived.add(1, { outcome: 'failed' });
    this.deps.logger.error('forum_thread_derivation_failed', {
      row_id: row.id,
      external_id: row.external_id,
      event_type: row.event_type,
      attempt: row.derivation_attempt_count + 1,
      reason,
      error: String(error),
    });
  }
}
