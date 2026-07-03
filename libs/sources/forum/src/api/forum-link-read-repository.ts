import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { ForumLinkView } from '@libs/domain';
import '../persistence/schema';

const CONFIDENCE_RANK: Record<ForumLinkView['confidence'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// Reads a proposal's forum-thread links (proposal_forum_link ⨝ forum_thread) for the API detail
// surface. Cross-source: keyed only by proposal_id. Ordered high→low confidence, then most
// recent activity first.
export class ForumLinkReadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async getLinksForProposal(proposalId: string): Promise<ForumLinkView[]> {
    const rows = await this.db
      .selectFrom('proposal_forum_link as pfl')
      .innerJoin('forum_thread as ft', 'ft.id', 'pfl.forum_thread_id')
      .select([
        'pfl.confidence',
        'ft.forum_host',
        'ft.forum_topic_id',
        'ft.title',
        'ft.last_activity_at',
      ])
      .where('pfl.proposal_id', '=', proposalId)
      .execute();

    return rows
      .map((row) => ({
        forum_host: row.forum_host,
        forum_topic_id: row.forum_topic_id,
        title: row.title,
        url: `https://${row.forum_host}/t/${row.forum_topic_id}`,
        confidence: row.confidence,
        last_activity_at: row.last_activity_at === null ? null : toIsoSeconds(row.last_activity_at),
      }))
      .sort(
        (a, b) =>
          CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
          (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''),
      );
  }
}

function toIsoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
