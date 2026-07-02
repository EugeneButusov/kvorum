import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { LinkConfidence, LinkMethod } from '../linking/matchers';

/** A proposal awaiting a forum-link scan (watermark NULL), of a forum-enabled DAO. */
export interface UnscannedProposal {
  id: string;
  daoId: string;
  title: string | null;
  description: string;
}

/** A candidate forum thread for matching. */
export interface LinkCandidateThread {
  id: string;
  forumHost: string;
  forumTopicId: string;
  title: string | null;
}

export interface NewForumLink {
  proposalId: string;
  forumThreadId: string;
  confidence: LinkConfidence;
  linkMethod: LinkMethod;
}

/** Data access for the proposal↔forum-thread linker: the proposal scan watermark, candidate lookup,
 *  and idempotent link inserts. */
export class ForumLinkRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /** Proposals of forum-enabled DAOs not yet link-scanned (watermark NULL), oldest first. */
  async findUnscannedProposals(limit: number): Promise<UnscannedProposal[]> {
    const rows = await this.db
      .selectFrom('proposal')
      .innerJoin('dao_source', (join) =>
        join
          .onRef('dao_source.dao_id', '=', 'proposal.dao_id')
          .on('dao_source.source_type', '=', 'discourse_forum'),
      )
      .where('proposal.forum_link_scanned_at', 'is', null)
      .select([
        'proposal.id as id',
        'proposal.dao_id as daoId',
        'proposal.title as title',
        'proposal.description as description',
      ])
      .orderBy('proposal.created_at', 'asc')
      .limit(limit)
      .execute();
    return rows;
  }

  /** Stamp proposals as scanned so the sweep doesn't reprocess them until a new thread re-queues. */
  async markProposalsScanned(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .updateTable('proposal')
      .set({ forum_link_scanned_at: sql`now()` })
      .where('id', 'in', ids)
      .execute();
  }

  /** All threads for a DAO (bounded), for the sweep's in-memory host/topic + title indexes. */
  async findThreadsByDao(daoId: string, limit: number): Promise<LinkCandidateThread[]> {
    return this.db
      .selectFrom('forum_thread')
      .where('dao_id', '=', daoId)
      .select(['id', 'forum_host as forumHost', 'forum_topic_id as forumTopicId', 'title'])
      .orderBy('last_activity_at', 'desc')
      .limit(limit)
      .execute();
  }

  /** Re-queue a DAO's not-yet-linked proposals for the sweep after a thread changes. Runs only on a
   *  genuine thread change (the mutable-latest consumer skips no-op re-crawls), and touches only
   *  unlinked proposals — linked ones stay put (idempotent inserts handle any additional matches). */
  async resetScanForUnlinkedProposals(daoId: string): Promise<number> {
    const result = await this.db
      .updateTable('proposal')
      .set({ forum_link_scanned_at: null })
      .where('dao_id', '=', daoId)
      .where('forum_link_scanned_at', 'is not', null)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('proposal_forum_link')
              .select('proposal_forum_link.id')
              .whereRef('proposal_forum_link.proposal_id', '=', 'proposal.id'),
          ),
        ),
      )
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  /** Insert a link, idempotent on the (proposal_id, forum_thread_id) unique constraint. */
  async insertLink(link: NewForumLink): Promise<void> {
    await this.db
      .insertInto('proposal_forum_link')
      .values({
        proposal_id: link.proposalId,
        forum_thread_id: link.forumThreadId,
        confidence: link.confidence,
        link_method: link.linkMethod,
      })
      .onConflict((oc) => oc.columns(['proposal_id', 'forum_thread_id']).doNothing())
      .execute();
  }
}
