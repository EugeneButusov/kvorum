// UInt64 block_number exceeds JS number precision; typed as string.
export interface EventArchiveCompoundGovernorBravoTable {
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

export type EventArchiveCompoundGovernorBravo = EventArchiveCompoundGovernorBravoTable;
// received_at is server-stamped; excluded from insert type.
export type NewEventArchiveCompoundGovernorBravo = Omit<
  EventArchiveCompoundGovernorBravoTable,
  'received_at'
>;

export interface CompoundProposalMetaTable {
  proposal_id: string;
  queued_at_block: string | null;
  last_reconcile_check_block: string | null;
}

// Extend @libs/db interfaces with compound-specific tables.
// Any compilation that transitively imports this file gets type-safe db access.
declare module '@libs/db' {
  interface ClickHouseDatabase {
    event_archive_compound_governor_bravo: EventArchiveCompoundGovernorBravoTable;
  }

  interface PgDatabase {
    compound_proposal_meta: CompoundProposalMetaTable;
  }
}
