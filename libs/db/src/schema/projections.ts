import type { Generated } from 'kysely';
import type { ClickHouseDatabase } from './clickhouse';

// VIEW interfaces — same column names as the former RMT tables; read code is unchanged.
// version is absent: VIEWs materialise argMaxMerge results, not raw rows.

export interface DelegationFlowProjectionTable {
  delegation_id: string;
  dao_id: string;
  delegator_address: string;
  delegate_address: string;
  voting_power: string;
  block_number: string;
  log_index: number;
  event_type: string;
  created_at: Date;
}

export interface VoteEventsProjectionTable {
  vote_id: string;
  dao_id: string;
  proposal_id: string;
  voter_address: string;
  voting_chain_id: string;
  primary_choice: number;
  voting_power: string;
  cast_at: Date;
  block_number: string;
  log_index: number;
  superseded: number;
  superseded_at: Date | null;
  superseded_by_vote_id: string | null;
}

// Raw table interfaces — used only by projection writers for insert.
// Same columns as the corresponding VIEW plus version (DEFAULT now64(6)).

export interface VoteEventsRawTable extends VoteEventsProjectionTable {
  version: Generated<Date>;
}

export interface DelegationFlowRawTable extends DelegationFlowProjectionTable {
  version: Generated<Date>;
}

declare module './clickhouse' {
  interface ClickHouseDatabase {
    // Views (reads)
    delegation_flow_projection: DelegationFlowProjectionTable;
    vote_events_projection: VoteEventsProjectionTable;
    // Raw forensic tables (writes)
    vote_events_raw: VoteEventsRawTable;
    delegation_flow_raw: DelegationFlowRawTable;
  }
}

type _ProjectionAugmentationCheck = ClickHouseDatabase['delegation_flow_projection'];
