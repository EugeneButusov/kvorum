import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Durable provider-batch state so an ai-worker restart no longer orphans a paid batch (#617).
//
// `ai_batch` holds each submitted-but-not-yet-drained batch. `handle` stores the complete provider
// handle, including the child handles used when one logical OpenAI batch is split by model. `items`
// stores the serializable metadata needed to price, validate, and persist each result after restart.
// A row is deleted in the same transaction that persists its results, so a mid-drain restart cannot
// double-count `ai_cost_log`.
//
// `ai_backfill_cursor` is the durable full-history walk position per backfill feature, so a restart
// resumes the scan instead of re-walking from the start.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ai_batch')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('provider_batch_id', 'text', (col) => col.notNull())
    .addColumn('handle', 'jsonb', (col) => col.notNull())
    .addColumn('feature', 'text', (col) => col.notNull())
    // The backfill walk position to commit once this batch drains; null for the live drivers.
    .addColumn('pending_cursor', 'text')
    // BatchItemDescriptor[] — everything needed to price + validate + persist without a live Zod
    // schema or the large inputContent.
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
