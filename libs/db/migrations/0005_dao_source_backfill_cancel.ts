import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('dao_source')
    .addColumn('backfill_cancel_requested_at', 'timestamptz')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('dao_source').dropColumn('backfill_cancel_requested_at').execute();
}
