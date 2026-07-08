import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// A poison event routed a brand-new ingestion_dlq row on every failed derivation attempt, so a
// single archive event could accumulate thousands of rows (observed: ~11.5k for one dual-governance
// ProposalSubmitted). Make the DLQ dedup on the archive tuple + stage: collapse existing duplicates,
// then add a UNIQUE partial index the insert upserts against (see DlqRepository.insert).
export async function up(db: Kysely<unknown>): Promise<void> {
  // Keep the highest-retries row per (archive tuple, stage); break ties deterministically by id.
  await sql`
    DELETE FROM ingestion_dlq a
    USING ingestion_dlq b
    WHERE a.archive_source_type IS NOT NULL
      AND a.archive_source_type = b.archive_source_type
      AND a.archive_chain_id    = b.archive_chain_id
      AND a.archive_tx_hash     = b.archive_tx_hash
      AND a.archive_log_index   = b.archive_log_index
      AND a.archive_block_hash  = b.archive_block_hash
      AND a.stage = b.stage
      AND (a.retries < b.retries OR (a.retries = b.retries AND a.id > b.id))
  `.execute(db);

  await sql`DROP INDEX IF EXISTS idx_ingestion_dlq_archive_tuple`.execute(db);
  await sql`
    CREATE UNIQUE INDEX idx_ingestion_dlq_archive_tuple_stage
    ON ingestion_dlq (archive_source_type, archive_chain_id, archive_tx_hash, archive_log_index, archive_block_hash, stage)
    WHERE archive_source_type IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_ingestion_dlq_archive_tuple_stage`.execute(db);
  await sql`
    CREATE INDEX idx_ingestion_dlq_archive_tuple
    ON ingestion_dlq (archive_source_type, archive_chain_id, archive_tx_hash, archive_log_index, archive_block_hash)
    WHERE archive_source_type IS NOT NULL
  `.execute(db);
}
