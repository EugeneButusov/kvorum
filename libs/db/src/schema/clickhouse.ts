export interface EventArchiveCompoundGovernorTable {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: string;
  // Server-stamped via DEFAULT now(); writers MUST NOT supply this column.
  received_at: Date;
  payload: string;
}

// ── ClickHouseDatabase ────────────────────────────────────────────────────────
// Per-source tables are registered via declaration merging in their respective
// libs/sources/* packages. Import a source lib to activate its augmentation.

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClickHouseDatabase {
  event_archive_compound_governor: EventArchiveCompoundGovernorTable;
}
