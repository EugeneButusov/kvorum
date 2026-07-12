import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Durable landing for pg-boss AI jobs that exhaust their retries. Distinct from `ai_dlq`
// (LLM schema-violation, keyed by content). Keyed at JOB identity (feature, entity_ref);
// repeated exhaustions of the same entity's job upsert one row (poison-safe), mirroring
// ingestion_dlq. `payload`/`error` are jsonb like ingestion_dlq so a job can be replayed.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ai_job_dlq')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('feature', 'text', (col) => col.notNull())
    .addColumn('entity_ref', 'text', (col) => col.notNull())
    .addColumn('input_hash', 'text')
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('error', 'jsonb', (col) => col.notNull())
    .addColumn('attempts', 'integer', (col) => col.notNull())
    .addColumn('first_seen_at', 'timestamptz', (col) => col.notNull())
    .addColumn('last_seen_at', 'timestamptz', (col) => col.notNull())
    .addUniqueConstraint('ai_job_dlq_key_uq', ['feature', 'entity_ref'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ai_job_dlq').execute();
}
