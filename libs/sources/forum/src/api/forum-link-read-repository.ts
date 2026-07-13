import type { Kysely } from 'kysely';
import { isoSeconds, type PgDatabase } from '@libs/db';
import type { OffchainDiscussionLinkView } from '@libs/domain';
import '../persistence/schema';

const CONFIDENCE_RANK: Record<OffchainDiscussionLinkView['confidence'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// Reads a proposal's linked Discourse threads (proposal_forum_link ⨝ forum_thread) and shapes them
// into the medium-neutral OffchainDiscussionLinkView. Cross-source: keyed only by proposal_id.
// Ordered high→low confidence, then most recent activity first.
export class ForumLinkReadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async getLinksForProposal(proposalId: string): Promise<OffchainDiscussionLinkView[]> {
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
        platform: 'discourse',
        host: row.forum_host,
        url: `https://${row.forum_host}/t/${row.forum_topic_id}`,
        title: row.title,
        confidence: row.confidence,
        last_activity_at: isoSeconds(row.last_activity_at),
      }))
      .sort(
        (a, b) =>
          CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
          (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''),
      );
  }
}
