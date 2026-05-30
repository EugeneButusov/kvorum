// CH projection row types are now canonical in @libs/db/src/schema/projections.
// Re-export here so @sources/core remains the historical import point for consumers
// that were already importing from @sources/core.

export type {
  VoteEventsProjectionTable as VoteEventsProjectionRow,
  DelegationFlowProjectionTable as DelegationFlowProjectionRow,
  VotingPowerSnapshotProjectionTable as VotingPowerSnapshotProjectionRow,
} from '@libs/db';

export type {
  NewVoteEventsProjectionRow,
  NewDelegationFlowProjectionRow,
  NewVotingPowerSnapshotProjectionRow,
} from '@libs/db';
