import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── Enum types ──────────────────────────────────────────────────────────────
  await sql`
    CREATE TYPE dlq_resolution_kind AS ENUM ('accepted', 'retry_succeeded')
  `.execute(db);

  // ── ingestion_dlq ────────────────────────────────────────────────────────────
  await db.schema
    .createTable('ingestion_dlq')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('stage', 'text', (col) => col.notNull())
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('error', 'jsonb', (col) => col.notNull())
    .addColumn('retries', 'integer', (col) => col.notNull())
    .addColumn('first_seen_at', 'timestamptz', (col) => col.notNull())
    .addColumn('last_attempt_at', 'timestamptz', (col) => col.notNull())
    // Typed archive-tuple columns: all five are NULL together when the DLQ row
    // has no archive origin (e.g. decode stage failure before any archive write).
    .addColumn('archive_source_type', 'text', (col) =>
      col.references('source_type.value').onDelete('restrict'),
    )
    .addColumn('archive_chain_id', sql`varchar(32)`)
    .addColumn('archive_tx_hash', 'text')
    .addColumn('archive_log_index', 'bigint')
    .addColumn('archive_block_hash', 'text')
    .execute();

  await db.schema
    .createIndex('idx_ingestion_dlq_stage_first_seen_at')
    .on('ingestion_dlq')
    .columns(['stage', 'first_seen_at'])
    .execute();

  // Partial composite btree for dlq retry archive-tuple lookups.
  await sql`
    CREATE INDEX idx_ingestion_dlq_archive_tuple
    ON ingestion_dlq (archive_source_type, archive_chain_id, archive_tx_hash, archive_log_index, archive_block_hash)
    WHERE archive_source_type IS NOT NULL
  `.execute(db);

  // ── ingestion_dlq_resolved ───────────────────────────────────────────────────
  await db.schema
    .createTable('ingestion_dlq_resolved')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // original_dlq_id is intentionally NOT an FK to ingestion_dlq — the source
    // row may be deleted on resolution; this is a soft reference for idempotency.
    .addColumn('original_dlq_id', 'uuid', (col) => col.notNull().unique())
    .addColumn('stage', 'text', (col) => col.notNull())
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('error', 'jsonb', (col) => col.notNull())
    .addColumn('retries', 'integer', (col) => col.notNull())
    .addColumn('first_seen_at', 'timestamptz', (col) => col.notNull())
    .addColumn('last_attempt_at', 'timestamptz', (col) => col.notNull())
    .addColumn('archive_source_type', 'text', (col) =>
      col.references('source_type.value').onDelete('restrict'),
    )
    .addColumn('archive_chain_id', sql`varchar(32)`)
    .addColumn('archive_tx_hash', 'text')
    .addColumn('archive_log_index', 'bigint')
    .addColumn('archive_block_hash', 'text')
    .addColumn('resolved_at', 'timestamptz', (col) => col.notNull())
    .addColumn('resolved_by', 'text', (col) => col.notNull())
    .addColumn('resolution_kind', sql`dlq_resolution_kind`, (col) => col.notNull())
    .addColumn('reason', 'text', (col) => col.notNull().check(sql`length(trim(reason)) > 0`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ingestion_dlq_resolved').execute();
  await db.schema.dropTable('ingestion_dlq').execute();

  await sql`DROP TYPE dlq_resolution_kind`.execute(db);
}
