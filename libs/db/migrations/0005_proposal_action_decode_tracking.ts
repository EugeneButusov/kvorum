import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TYPE decode_status AS ENUM ('pending', 'decoded', 'undecodable')`.execute(db);

  await db.schema
    .alterTable('proposal_action')
    .addColumn('decode_status', sql`decode_status`, (col) => col.notNull().defaultTo('pending'))
    .addColumn('decode_attempted_at', 'timestamptz')
    .addColumn('decode_attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('next_decode_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_proposal_action_pending_decode')
    .on('proposal_action')
    .columns(['next_decode_at', 'created_at'])
    .where(sql`decode_status = 'pending'`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_proposal_action_pending_decode').execute();

  await db.schema.alterTable('proposal_action').dropColumn('next_decode_at').execute();
  await db.schema.alterTable('proposal_action').dropColumn('decode_attempt_count').execute();
  await db.schema.alterTable('proposal_action').dropColumn('decode_attempted_at').execute();
  await db.schema.alterTable('proposal_action').dropColumn('decode_status').execute();

  await sql`DROP TYPE decode_status`.execute(db);
}
