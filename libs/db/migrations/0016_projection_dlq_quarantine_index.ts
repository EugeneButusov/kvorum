import { sql, type Kysely } from 'kysely';

/**
 * Supports the derivation selector's exact archive-tuple lookup for projection failures an
 * operator permanently accepted under ADR-032. Active DLQ rows already use the equivalent unique
 * index created by 0003_ingestion_dlq.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX idx_ingestion_dlq_resolved_projection_quarantine
    ON ingestion_dlq_resolved (
      archive_source_type,
      archive_chain_id,
      archive_tx_hash,
      archive_log_index,
      archive_block_hash,
      stage
    )
    WHERE archive_source_type IS NOT NULL
      AND resolution_kind = 'accepted'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_ingestion_dlq_resolved_projection_quarantine`.execute(db);
}
