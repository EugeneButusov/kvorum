import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE proposal_forum_link_confidence AS ENUM ('high', 'medium')
  `.execute(db);

  await db.schema
    .createTable('forum_thread')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('dao_id', 'uuid', (col) => col.notNull().references('dao.id').onDelete('restrict'))
    .addColumn('forum_host', 'text', (col) => col.notNull())
    .addColumn('forum_topic_id', 'bigint', (col) => col.notNull())
    .addColumn('raw_content', 'text')
    .addColumn('content_pipeline_version', 'text')
    .addColumn('post_count', 'integer')
    .addColumn('last_activity_at', 'timestamptz')
    .addUniqueConstraint('forum_thread_host_topic_key', ['forum_host', 'forum_topic_id'])
    .execute();

  await db.schema
    .createTable('proposal_forum_link')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('proposal_id', 'uuid', (col) =>
      col.notNull().references('proposal.id').onDelete('cascade'),
    )
    .addColumn('forum_thread_id', 'uuid', (col) =>
      col.notNull().references('forum_thread.id').onDelete('cascade'),
    )
    .addColumn('confidence', sql`proposal_forum_link_confidence`, (col) => col.notNull())
    .addColumn('link_method', 'text', (col) => col.notNull())
    .addUniqueConstraint('proposal_forum_link_proposal_thread_key', [
      'proposal_id',
      'forum_thread_id',
    ])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('proposal_forum_link').execute();
  await db.schema.dropTable('forum_thread').execute();
  await sql`DROP TYPE proposal_forum_link_confidence`.execute(db);
}
