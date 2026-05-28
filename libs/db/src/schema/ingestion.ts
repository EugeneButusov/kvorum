import type { Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { SourceType } from './domain';

// ── Enum string-literal unions ────────────────────────────────────────────────

export type DlqResolutionKind = 'accepted' | 'retry_succeeded';

// ── Table row types ───────────────────────────────────────────────────────────

export interface ArchiveEventTable {
  id: Generated<string>;
  source_type: SourceType;
  dao_source_id: string;
  chain_id: string;
  // pg driver returns bigint as string
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: string;
  received_at: Date;
  derived_at: Date | null;
  derivation_actor_resolved_at: Date | null;
  derivation_attempt_count: Generated<number>;
  actor_resolution_attempt_count: Generated<number>;
}

export type ArchiveEvent = Selectable<ArchiveEventTable>;
export type NewArchiveEvent = Insertable<ArchiveEventTable>;
export type ArchiveEventUpdate = Updateable<ArchiveEventTable>;

export interface IngestionDlqTable {
  id: Generated<string>;
  stage: string;
  source: string;
  payload: unknown;
  error: unknown;
  retries: number;
  first_seen_at: Date;
  last_attempt_at: Date;
  archive_source_type: SourceType | null;
  archive_chain_id: string | null;
  archive_tx_hash: string | null;
  archive_log_index: number | null;
  archive_block_hash: string | null;
}

export type IngestionDlq = Selectable<IngestionDlqTable>;
export type NewIngestionDlq = Insertable<IngestionDlqTable>;

export interface IngestionDlqResolvedTable {
  id: Generated<string>;
  // Soft reference to ingestion_dlq.id — intentionally not an FK (source row
  // may be deleted on resolution). UNIQUE for replay idempotency.
  original_dlq_id: string;
  stage: string;
  source: string;
  payload: unknown;
  error: unknown;
  retries: number;
  first_seen_at: Date;
  last_attempt_at: Date;
  archive_source_type: SourceType | null;
  archive_chain_id: string | null;
  archive_tx_hash: string | null;
  archive_log_index: number | null;
  archive_block_hash: string | null;
  resolved_at: Date;
  resolved_by: string;
  resolution_kind: DlqResolutionKind;
  reason: string;
}

export type IngestionDlqResolved = Selectable<IngestionDlqResolvedTable>;
export type NewIngestionDlqResolved = Insertable<IngestionDlqResolvedTable>;

export interface ReconciliationWatermarkTable {
  sweep_name: string;
  dao_source_id: string;
  // pg bigint values are represented as strings by the driver
  last_swept_block_number: string;
  last_swept_tx_hash: string;
  last_swept_log_index: number;
  last_sweep_at: Date | null;
}

export type ReconciliationWatermark = Selectable<ReconciliationWatermarkTable>;
export type NewReconciliationWatermark = Insertable<ReconciliationWatermarkTable>;
