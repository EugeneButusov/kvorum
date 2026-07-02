import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { PgDatabase } from '@libs/db';

export interface ForumThreadUpsert {
  daoId: string;
  forumHost: string;
  forumTopicId: string;
  title: string | null;
  rawContent: string;
  contentPipelineVersion: string;
  postCount: number;
  lastActivityAt: Date | null;
}

export interface ForumThreadUpsertResult {
  /** True when this call inserted a brand-new thread (vs. updating an existing one). Lets the
   *  linker re-queue proposals only for genuinely new threads, not reply-only edits. */
  inserted: boolean;
}

/** Upserts `forum_thread`, the standalone PG projection of a crawled Discourse thread. Keyed on the
 *  natural (forum_host, forum_topic_id) unique constraint so a re-crawled/edited thread updates its
 *  mutable fields in place; `dao_id` is set on insert and never rewritten. */
export class ForumThreadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async upsert(row: ForumThreadUpsert): Promise<ForumThreadUpsertResult> {
    const result = await this.db
      .insertInto('forum_thread')
      .values({
        dao_id: row.daoId,
        forum_host: row.forumHost,
        forum_topic_id: row.forumTopicId,
        title: row.title,
        raw_content: row.rawContent,
        content_pipeline_version: row.contentPipelineVersion,
        post_count: row.postCount,
        last_activity_at: row.lastActivityAt,
      })
      .onConflict((oc) =>
        oc.columns(['forum_host', 'forum_topic_id']).doUpdateSet({
          title: row.title,
          raw_content: row.rawContent,
          content_pipeline_version: row.contentPipelineVersion,
          post_count: row.postCount,
          last_activity_at: row.lastActivityAt,
        }),
      )
      // `xmax = 0` on the returned row means it was freshly inserted, not updated by the conflict.
      .returning(sql<boolean>`(xmax = 0)`.as('inserted'))
      .executeTakeFirst();
    return { inserted: result?.inserted ?? false };
  }
}
