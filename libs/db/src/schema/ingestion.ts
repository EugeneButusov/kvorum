import type { Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { ArchiveEventType, JsonValue } from '@libs/domain';
import type { SourceType } from './domain';

// ── Enum string-literal unions ────────────────────────────────────────────────

export type DlqResolutionKind = 'accepted' | 'retry_succeeded';

// ── Table row types ───────────────────────────────────────────────────────────

export interface ArchiveEventTable {
  id: Generated<string>;
  source_type: SourceType;
  dao_source_id: string;
  chain_id: string;
  // Block/tx coords are non-null for EVM rows and null for off-chain rows
  // (identified by external_id instead). The archive_event_identity_shape CHECK
  // enforces exactly one shape — see 0002_core_domain / ADR-071.
  // pg driver returns bigint as string
  block_number: string | null;
  block_hash: string | null;
  tx_hash: string | null;
  log_index: number | null;
  /** Source-native id for off-chain rows (Snapshot proposal hash, Discourse topic id); null for EVM. */
  external_id: string | null;
  /** Off-chain ordering key (source-native ordinal); null for EVM rows. See ADR-071/ADR-072. */
  derivation_ordinal: string | null;
  /** Hash of the latest archived payload slice (off-chain mutable-latest); null for EVM rows. */
  content_hash: string | null;
  /** PG-maintained monotonic version, bumped on content change; CH RMT sort key. Null for EVM. */
  version: number | null;
  event_type: ArchiveEventType;
  received_at: Date;
  derived_at: Date | null;
  derivation_actor_resolved_at: Date | null;
  /**
   * Re-check time for an intentionally deferred row (KNOWN-028). An applier that cannot derive yet
   * because a cross-chain counterpart has not landed (ADR-065 `no_proposal`, payload
   * `no_declared_payload`) stamps a future time here; the derivable queries skip the row until it
   * passes, so a hold never occupies the head of the block-ordered queue. Null = not held.
   */
  derivation_hold_until: Date | null;
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

/** Off-chain poll cursor watermark, one row per dao_source (ADR-071 §off-chain consumer).
 *  `cursor` is the partition-aware TCursor blob; a restart resumes from it. */
export interface OffChainCursorTable {
  dao_source_id: string;
  /** Partition-aware poll cursor blob (jsonb); null when reset to start. */
  cursor: JsonValue | null;
  updated_at: Date;
}

export type OffChainCursor = Selectable<OffChainCursorTable>;
export type NewOffChainCursor = Insertable<OffChainCursorTable>;
export type OffChainCursorUpdate = Updateable<OffChainCursorTable>;
