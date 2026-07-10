import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── ai_output ── immutable content-hash cache (UNIQUE lookup key) ─────────────
  await db.schema
    .createTable('ai_output')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('feature_name', 'text', (col) => col.notNull())
    .addColumn('prompt_version', 'text', (col) => col.notNull())
    .addColumn('input_hash', 'text', (col) => col.notNull())
    .addColumn('model', 'text', (col) => col.notNull())
    .addColumn('output', 'jsonb', (col) => col.notNull())
    .addColumn('cost_usd', sql`numeric(12, 6)`, (col) => col.notNull())
    .addColumn('generated_at', 'timestamptz', (col) => col.notNull())
    .addColumn('source_provenance', 'jsonb', (col) => col.notNull())
    .addUniqueConstraint('ai_output_key_uq', ['feature_name', 'prompt_version', 'input_hash'])
    .execute();

  // ── ai_cost_log ── append-only cost ledger ───────────────────────────────────
  await db.schema
    .createTable('ai_cost_log')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
    .addColumn('feature_name', 'text', (col) => col.notNull())
    .addColumn('model', 'text', (col) => col.notNull())
    .addColumn('input_tokens', 'integer', (col) => col.notNull())
    .addColumn('output_tokens', 'integer', (col) => col.notNull())
    .addColumn('cost_usd', sql`numeric(12, 6)`, (col) => col.notNull())
    .addColumn('dao_id', 'uuid')
    .addColumn('entity_reference', 'text')
    .execute();

  await db.schema
    .createIndex('idx_ai_cost_log_feature_time')
    .on('ai_cost_log')
    .columns(['feature_name', 'timestamp'])
    .execute();

  // ── ai_dlq ── schema-violation dead-letter (UNIQUE key, upsert-bumped) ────────
  await db.schema
    .createTable('ai_dlq')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('feature_name', 'text', (col) => col.notNull())
    .addColumn('prompt_version', 'text', (col) => col.notNull())
    .addColumn('input_hash', 'text', (col) => col.notNull())
    .addColumn('model', 'text', (col) => col.notNull())
    .addColumn('raw_output', 'jsonb')
    .addColumn('zod_error', 'jsonb', (col) => col.notNull())
    .addColumn('attempts', 'integer', (col) => col.notNull())
    .addColumn('first_seen_at', 'timestamptz', (col) => col.notNull())
    .addColumn('last_seen_at', 'timestamptz', (col) => col.notNull())
    .addUniqueConstraint('ai_dlq_key_uq', ['feature_name', 'prompt_version', 'input_hash'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ai_dlq').execute();
  await db.schema.dropTable('ai_cost_log').execute();
  await db.schema.dropTable('ai_output').execute();
}
