import type { AaveGovernorV2EventType } from '../abi/events';

export interface EventArchiveAaveGovernorV2Table {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: AaveGovernorV2EventType;
  received_at: Date;
  payload: string;
}

export type EventArchiveAaveGovernorV2 = EventArchiveAaveGovernorV2Table;
export type NewEventArchiveAaveGovernorV2 = Omit<EventArchiveAaveGovernorV2Table, 'received_at'>;

declare module '@libs/db' {
  interface ClickHouseDatabase {
    archive_event_aave_governor_v2: EventArchiveAaveGovernorV2Table;
  }
}
