import type { Generated, Insertable, Selectable } from 'kysely';

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
