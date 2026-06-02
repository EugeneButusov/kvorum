import type { AaveGovernanceV3EventType } from '../abi/events';

// UInt64 block_number exceeds JS number precision; typed as string.
export interface EventArchiveAaveGovernanceV3Table {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: AaveGovernanceV3EventType;
  received_at: Date;
  payload: string;
}

export type EventArchiveAaveGovernanceV3 = EventArchiveAaveGovernanceV3Table;
export type NewEventArchiveAaveGovernanceV3 = Omit<
  EventArchiveAaveGovernanceV3Table,
  'received_at'
>;

declare module '@libs/db' {
  interface ClickHouseDatabase {
    archive_event_aave_governance_v3: EventArchiveAaveGovernanceV3Table;
  }
}
