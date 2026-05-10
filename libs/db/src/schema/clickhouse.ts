// ── event_archive_compound_governor ──────────────────────────────────────────
// Raw event archive for the Compound Governor source (ReplacingMergeTree).
// The SQL migration lives in libs/sources/compound/migrations-clickhouse/.

export interface EventArchiveCompoundGovernorTable {
  dao_source_id: string;
  chain_id: number;
  // UInt64 — may exceed JS number precision; typed as string
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: string;
  received_at: Date;
  payload: string;
}

export type EventArchiveCompoundGovernor = EventArchiveCompoundGovernorTable;
export type NewEventArchiveCompoundGovernor = EventArchiveCompoundGovernorTable;

// ── ClickHouseDatabase ────────────────────────────────────────────────────────

export interface ClickHouseDatabase {
  event_archive_compound_governor: EventArchiveCompoundGovernorTable;
}
