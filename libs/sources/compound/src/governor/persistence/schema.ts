// UInt64 block_number exceeds JS number precision; typed as string.
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

export type EventArchiveCompoundGovernor = EventArchiveCompoundGovernorTable;
// received_at is server-stamped; excluded from insert type.
export type NewEventArchiveCompoundGovernor = Omit<
  EventArchiveCompoundGovernorTable,
  'received_at'
>;

// Extend @libs/db's ClickHouseDatabase with compound governor tables.
// Any compilation that transitively imports this file gets type-safe chDb access.
declare module '@libs/db' {
  interface ClickHouseDatabase {
    event_archive_compound_governor: EventArchiveCompoundGovernorTable;
  }
}
