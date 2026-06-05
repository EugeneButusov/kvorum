/**
 * Union of all event_type values written to archive_event.
 * Add a new protocol's event strings here when registering a new source.
 */
export type ArchiveEventType =
  | 'ProposalCreated'
  | 'ProposalQueued'
  | 'ProposalExecuted'
  | 'ProposalCanceled'
  | 'ProposalResultsSent'
  | 'ProposalVoteConfigurationBridged'
  | 'ProposalVoteStarted'
  | 'VoteCast'
  | 'VoteEmitted'
  | 'DelegateChanged'
  | 'DelegateVotesChanged'
  | 'VotingActivated'
  | 'ProposalFailed'
  | 'PayloadSent';
