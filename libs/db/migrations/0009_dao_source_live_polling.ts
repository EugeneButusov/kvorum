import type { Kysely } from 'kysely';

// Per-source live-polling gate. When false, the indexer orchestrator skips this source's live
// poller at startup (the cursor is left untouched) — used to hold an un-backfilled DAO's sources
// off until its backfill runs. Durable across deploys, unlike the INDEXER_LIVE_POLLER_* env
// overrides which a `kubectl apply -k` resets. Defaults false so a source never advances its
// cursor until an operator explicitly enables it (`daos source resume <id>`) after its backfill
// completes — an un-backfilled source silently skipping ahead is the failure this gate prevents.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('dao_source')
    .addColumn('live_polling_enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('dao_source').dropColumn('live_polling_enabled').execute();
}
