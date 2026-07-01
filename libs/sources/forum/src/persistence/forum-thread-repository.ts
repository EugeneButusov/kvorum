import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';

export interface ForumThreadUpsert {
  daoId: string;
  forumHost: string;
  forumTopicId: string;
  rawContent: string;
  contentPipelineVersion: string;
  postCount: number;
  lastActivityAt: Date | null;
}

/** Upserts `forum_thread`, the standalone PG projection of a crawled Discourse thread. Keyed on the
 *  natural (forum_host, forum_topic_id) unique constraint so a re-crawled/edited thread updates its
 *  mutable fields in place; `dao_id` is set on insert and never rewritten. */
export class ForumThreadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async upsert(row: ForumThreadUpsert): Promise<void> {
    await this.db
      .insertInto('forum_thread')
      .values({
        dao_id: row.daoId,
        forum_host: row.forumHost,
        forum_topic_id: row.forumTopicId,
        raw_content: row.rawContent,
        content_pipeline_version: row.contentPipelineVersion,
        post_count: row.postCount,
        last_activity_at: row.lastActivityAt,
      })
      .onConflict((oc) =>
        oc.columns(['forum_host', 'forum_topic_id']).doUpdateSet({
          raw_content: row.rawContent,
          content_pipeline_version: row.contentPipelineVersion,
          post_count: row.postCount,
          last_activity_at: row.lastActivityAt,
        }),
      )
      .execute();
  }
}
