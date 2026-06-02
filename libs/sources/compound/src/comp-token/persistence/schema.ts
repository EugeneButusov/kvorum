import type { ClickHouseDatabase } from '@libs/db';
import type { TokenDelegationEventType } from '@libs/domain';

// UInt64 block_number exceeds JS number precision; typed as string.
export interface EventArchiveCompoundCompTokenTable {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: TokenDelegationEventType;
  // Server-stamped via DEFAULT now(); writers MUST NOT supply this column.
  received_at: Date;
  payload: string;
}

export type EventArchiveCompoundCompToken = EventArchiveCompoundCompTokenTable;
// received_at is server-stamped; excluded from insert type.
export type NewEventArchiveCompoundCompToken = Omit<
  EventArchiveCompoundCompTokenTable,
  'received_at'
>;

// Extend @libs/db's ClickHouseDatabase via declaration merging.
// Any compilation that transitively imports this file gets type-safe db access.
declare module '@libs/db' {
  interface ClickHouseDatabase {
    archive_event_compound_comp_token: EventArchiveCompoundCompTokenTable;
  }
}

type _AugmentationActiveCheck = ClickHouseDatabase['archive_event_compound_comp_token'];
