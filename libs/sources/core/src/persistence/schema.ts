import type { Generated } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';

export interface VoteEventsFlatRow {
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

export type NewVoteEventsFlatRow = Omit<VoteEventsFlatRow, 'version'>;

export interface DelegationFlowFlatRow {
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

export type NewDelegationFlowFlatRow = Omit<DelegationFlowFlatRow, 'version'>;

export interface VotingPowerSnapshotFlatRow {
  dao_id: string;
  proposal_id: string;
  actor_address: string;
  voting_power: string;
  actor_id_hint: string | null;
  computed_at: Date;
  version: Generated<Date>;
}

export type NewVotingPowerSnapshotFlatRow = Omit<VotingPowerSnapshotFlatRow, 'version'>;

declare module '@libs/db' {
  interface ClickHouseDatabase {
    vote_events_flat: VoteEventsFlatRow;
    delegation_flow_flat: DelegationFlowFlatRow;
    voting_power_snapshot_flat: VotingPowerSnapshotFlatRow;
  }
}

type _VoteEventsFlatAugmentationActiveCheck = ClickHouseDatabase['vote_events_flat'];
type _DelegationFlowFlatAugmentationActiveCheck = ClickHouseDatabase['delegation_flow_flat'];
type _VotingPowerSnapshotFlatAugmentationActiveCheck =
  ClickHouseDatabase['voting_power_snapshot_flat'];
