import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Durable batch state so an ai-worker restart no longer orphans a paid Anthropic batch (#617).
//
// `ai_batch` holds each submitted-but-not-yet-drained Message Batch: the provider batch id (to
// re-poll after a restart) plus a self-contained `items` descriptor per custom_id — model (to
// re-price; the Batch API results stream doesn't echo the model), feature/prompt_version/input_hash
// (to validate + persist), and dao_id/entity_reference (the cost-log context). A row exists only
// while the batch is in flight; the drain deletes it in the same transaction that persists its
// results, so re-polling after a mid-drain restart can't double-count `ai_cost_log`.
//
// `ai_backfill_cursor` is the durable full-history walk position per backfill feature, so a restart
// resumes the scan instead of re-walking from the start.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ai_batch')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('provider_batch_id', 'text', (col) => col.notNull())
    .addColumn('feature', 'text', (col) => col.notNull())
    // The backfill walk position to commit once this batch drains; null for the live drivers.
    .addColumn('pending_cursor', 'text')
    // jsonb array of item descriptors: { customId, model, promptVersion, inputHash, routingReason?,
    // daoId, entityReference } — everything needed to price + validate + persist a result without
    // the non-serializable Zod schema or the large inputContent.
    .addColumn('items', 'jsonb', (col) => col.notNull())
    .addColumn('submitted_at', 'timestamptz', (col) => col.notNull())
    .addUniqueConstraint('ai_batch_provider_batch_id_uq', ['provider_batch_id'])
    .execute();

  await db.schema
    .createTable('ai_backfill_cursor')
    .addColumn('feature', 'text', (col) => col.primaryKey())
    .addColumn('cursor', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ai_backfill_cursor').execute();
  await db.schema.dropTable('ai_batch').execute();
}
