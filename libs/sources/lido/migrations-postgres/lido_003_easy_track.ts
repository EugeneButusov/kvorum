import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`INSERT INTO source_type (value) VALUES ('easy_track') ON CONFLICT DO NOTHING`.execute(
    db,
  );

  await sql`
    CREATE TYPE easy_track_motion_state AS ENUM (
      'active',
      'enacted',
      'objected',
      'rejected',
      'canceled'
    )
  `.execute(db);

  await db.schema
    .createTable('easy_track_motion_meta')
    .addColumn('proposal_id', 'uuid', (col) =>
      col.primaryKey().references('proposal.id').onDelete('cascade'),
    )
    .addColumn('motion_id', 'bigint', (col) => col.notNull())
    .addColumn('factory_address', 'text', (col) => col.notNull())
    .addColumn('objection_ends_at', 'timestamptz', (col) => col.notNull())
    .addColumn('state', sql`easy_track_motion_state`, (col) => col.notNull())
    .addColumn('last_reconcile_check_block', 'bigint')
    .execute();

  await db.schema
    .createIndex('idx_easy_track_motion_meta_recheck')
    .on('easy_track_motion_meta')
    .column('last_reconcile_check_block')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_easy_track_motion_meta_recheck').execute();
  await db.schema.dropTable('easy_track_motion_meta').execute();
  await sql`DROP TYPE easy_track_motion_state`.execute(db);
  await sql`DELETE FROM source_type WHERE value = 'easy_track'`.execute(db);
}
