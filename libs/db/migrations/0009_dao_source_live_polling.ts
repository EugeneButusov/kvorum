import type { Kysely } from 'kysely';

// Per-source live-polling gate. When false, the indexer orchestrator skips this source's live
// poller at startup (the cursor is left untouched) — used to hold an un-backfilled DAO's sources
// off until its backfill runs. Durable across deploys, unlike the INDEXER_LIVE_POLLER_* env
// overrides which a `kubectl apply -k` resets. Defaults true so existing rows keep polling.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('dao_source')
    .addColumn('live_polling_enabled', 'boolean', (col) => col.notNull().defaultTo(true))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('dao_source').dropColumn('live_polling_enabled').execute();
}
