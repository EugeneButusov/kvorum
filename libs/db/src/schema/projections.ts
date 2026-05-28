import type { Generated } from 'kysely';
import type { ClickHouseDatabase } from './clickhouse';

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
  version: Generated<Date>;
}

export interface VoteEventsProjectionTable {
  vote_id: string;
  dao_id: string;
  proposal_id: string;
  voter_address: string;
  primary_choice: number;
  voting_power: string;
  cast_at: Date;
  block_number: string;
  log_index: number;
  superseded: number;
  superseded_at: Date | null;
  superseded_by_vote_id: string | null;
  version: Generated<Date>;
}

export interface VotingPowerSnapshotProjectionTable {
  dao_id: string;
  proposal_id: string;
  actor_address: string;
  voting_power: string;
  actor_id_hint: string | null;
  computed_at: Date;
  version: Generated<Date>;
}

declare module './clickhouse' {
  interface ClickHouseDatabase {
    delegation_flow_projection: DelegationFlowProjectionTable;
    vote_events_projection: VoteEventsProjectionTable;
    voting_power_snapshot_projection: VotingPowerSnapshotProjectionTable;
  }
}

type _ProjectionAugmentationCheck = ClickHouseDatabase['delegation_flow_projection'];
