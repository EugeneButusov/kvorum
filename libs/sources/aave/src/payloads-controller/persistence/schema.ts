import type { AavePayloadsControllerEventType } from '../abi/events';

export interface EventArchiveAavePayloadsControllerTable {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: AavePayloadsControllerEventType;
  received_at: Date;
  payload: string;
}

export type EventArchiveAavePayloadsController = EventArchiveAavePayloadsControllerTable;
export type NewEventArchiveAavePayloadsController = Omit<
  EventArchiveAavePayloadsControllerTable,
  'received_at'
>;

declare module '@libs/db' {
  interface ClickHouseDatabase {
    archive_event_aave_payloads_controller: EventArchiveAavePayloadsControllerTable;
  }
}
