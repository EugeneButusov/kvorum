import type { ClickHouseDatabase } from '@libs/db';
import type { AaveTokenEventType } from '../abi/events';

// UInt64 block_number exceeds JS number precision; typed as string.
export interface EventArchiveAaveTokenTable {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: AaveTokenEventType;
  // Server-stamped via DEFAULT now(); writers MUST NOT supply this column.
  received_at: Date;
  payload: string;
}

export type EventArchiveAaveToken = EventArchiveAaveTokenTable;
// received_at is server-stamped; excluded from insert type.
export type NewEventArchiveAaveToken = Omit<EventArchiveAaveTokenTable, 'received_at'>;

// Extend @libs/db's ClickHouseDatabase via declaration merging.
declare module '@libs/db' {
  interface ClickHouseDatabase {
    archive_event_aave_token: EventArchiveAaveTokenTable;
  }
}

type _AugmentationActiveCheck = ClickHouseDatabase['archive_event_aave_token'];
