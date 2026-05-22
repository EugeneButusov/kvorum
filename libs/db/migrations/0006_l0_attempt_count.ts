import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE archive_confirmation
    ADD COLUMN actor_resolution_attempt_count INTEGER NOT NULL DEFAULT 0
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('archive_confirmation')
    .dropColumn('actor_resolution_attempt_count')
    .execute();
}
