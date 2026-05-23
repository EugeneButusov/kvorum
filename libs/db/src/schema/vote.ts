import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

export interface VoteTable {
  id: Generated<string>;
  proposal_id: string;
  voter_actor_id: string;
  voting_power_reported: string;
  voting_power_computed: string | null;
  voting_power_verified: Generated<boolean>;
  voting_power_discrepancy: string | null;
  cast_at: Date;
  block_number: string | null;
  tx_index: Generated<number>;
  tx_hash: string | null;
  log_index: number | null;
  source_id: string | null;
  reason: string | null;
  primary_choice: number | null;
  superseded_by_vote_id: string | null;
  superseded_at: Date | null;
  created_at: Generated<Date>;
}

export type Vote = Selectable<VoteTable>;
export type NewVote = Insertable<VoteTable>;
export type VoteUpdate = Updateable<VoteTable>;

export interface VoteChoiceTable {
  vote_id: string;
  choice_index: number;
  weight: Generated<string>;
}

export type VoteChoice = Selectable<VoteChoiceTable>;
export type NewVoteChoice = Insertable<VoteChoiceTable>;

export interface VotingPowerSnapshotTable {
  id: Generated<string>;
  actor_id: string;
  dao_id: string;
  proposal_id: string;
  block_number: string;
  power: string;
  computed_at: Generated<Date>;
}

export type VotingPowerSnapshot = Selectable<VotingPowerSnapshotTable>;
export type NewVotingPowerSnapshot = Insertable<VotingPowerSnapshotTable>;

export type VotingPowerSnapshotRunStatus = 'in_progress' | 'completed' | 'failed';

export interface VotingPowerSnapshotRunTable {
  proposal_id: string;
  voting_power_block: string;
  status: VotingPowerSnapshotRunStatus;
  snapshot_attempt_count: Generated<number>;
  last_error: string | null;
  last_attempt_at: Date | null;
  rows_inserted: Generated<number>;
  population_size: Generated<number>;
  sample_size: Generated<number>;
  fallback_engaged: Generated<boolean>;
  started_at: Date;
  completed_at: Date | null;
}

export type VotingPowerSnapshotRun = Selectable<VotingPowerSnapshotRunTable>;
export type NewVotingPowerSnapshotRun = Insertable<VotingPowerSnapshotRunTable>;
