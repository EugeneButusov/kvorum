import type { AaveVotingMachineEventType } from '../abi/events';

// UInt64 block_number exceeds JS number precision; typed as string.
export interface EventArchiveAaveVotingMachineTable {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: AaveVotingMachineEventType;
  received_at: Date;
  payload: string;
}

export type EventArchiveAaveVotingMachine = EventArchiveAaveVotingMachineTable;
export type NewEventArchiveAaveVotingMachine = Omit<
  EventArchiveAaveVotingMachineTable,
  'received_at'
>;

declare module '@libs/db' {
  interface ClickHouseDatabase {
    archive_event_aave_voting_machine: EventArchiveAaveVotingMachineTable;
  }
}
