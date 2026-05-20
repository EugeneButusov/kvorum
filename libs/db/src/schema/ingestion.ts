import type { Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { SourceType } from './domain';

// ── Enum string-literal unions ────────────────────────────────────────────────

export type ConfirmationStatus = 'pending' | 'confirmed' | 'orphaned';
export type DlqResolutionKind = 'accepted' | 'retry_succeeded';

// ── Table row types ───────────────────────────────────────────────────────────

export interface ArchiveConfirmationTable {
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
  confirmation_status: ConfirmationStatus;
  confirmed_at: Date | null;
  orphaned_at: Date | null;
  orphaned_by_reorg_event_id: string | null;
  derived_at: Date | null;
  derivation_actor_resolved_at: Date | null;
  derivation_attempt_count: Generated<number>;
}

export type ArchiveConfirmation = Selectable<ArchiveConfirmationTable>;
export type NewArchiveConfirmation = Insertable<ArchiveConfirmationTable>;
export type ArchiveConfirmationUpdate = Updateable<ArchiveConfirmationTable>;

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
