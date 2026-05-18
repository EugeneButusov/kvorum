import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('proposal')
    .addColumn('timelock_eta', 'timestamptz')
    .addColumn('last_reconcile_check_block', 'bigint')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('proposal')
    .dropColumn('last_reconcile_check_block')
    .dropColumn('timelock_eta')
    .execute();
}
