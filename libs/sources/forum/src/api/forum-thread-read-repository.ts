import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import '../persistence/schema';
import type { ProposalForumLinkConfidence } from '../persistence/schema';

const CONFIDENCE_RANK: Record<ProposalForumLinkConfidence, number> = { high: 0, medium: 1, low: 2 };

export type ForumThreadLinkedProposal = {
  source_type: string;
  source_id: string;
  title: string | null;
  confidence: ProposalForumLinkConfidence;
};

export type ForumThreadRead = {
  external_id: string;
  host: string;
  source_url: string;
  title: string | null;
  raw_content: string | null;
  post_count: number | null;
  last_activity_at: string | null;
  linked_proposals: ForumThreadLinkedProposal[];
};

/**
 * Reads a single forum thread by (DAO slug, Discourse topic id) plus the proposals it links to —
 * the standalone forum-thread page's data (§6.12). `raw_content` is the concatenated post bodies
 * (no per-post table); the AI `summary` is deferred to M5.
 */
export class ForumThreadReadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async getThread(daoSlug: string, externalId: string): Promise<ForumThreadRead | undefined> {
    const thread = await this.db
      .selectFrom('forum_thread as ft')
      .innerJoin('dao as d', 'd.id', 'ft.dao_id')
      .select([
        'ft.id',
        'ft.forum_host',
        'ft.forum_topic_id',
        'ft.title',
        'ft.raw_content',
        'ft.post_count',
        'ft.last_activity_at',
      ])
      .where('d.slug', '=', daoSlug)
      .where('ft.forum_topic_id', '=', externalId)
      .executeTakeFirst();
    if (thread === undefined) return undefined;

    const links = await this.db
      .selectFrom('proposal_forum_link as pfl')
      .innerJoin('proposal as p', 'p.id', 'pfl.proposal_id')
      .select(['p.source_type', 'p.source_id', 'p.title', 'pfl.confidence'])
      .where('pfl.forum_thread_id', '=', thread.id)
      .execute();

    return {
      external_id: thread.forum_topic_id,
      host: thread.forum_host,
      source_url: `https://${thread.forum_host}/t/${thread.forum_topic_id}`,
      title: thread.title,
      raw_content: thread.raw_content,
      post_count: thread.post_count,
      last_activity_at:
        thread.last_activity_at === null ? null : toIsoSeconds(thread.last_activity_at),
      linked_proposals: links
        .sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence])
        .map((l) => ({
          source_type: l.source_type,
          source_id: l.source_id,
          title: l.title,
          confidence: l.confidence,
        })),
    };
  }
}

function toIsoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
