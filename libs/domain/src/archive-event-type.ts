/** Proposal lifecycle events emitted by multiple on-chain governance protocols. */
export type SharedGovernanceEventType =
  | 'ProposalCreated'
  | 'ProposalQueued'
  | 'ProposalExecuted'
  | 'ProposalCanceled';

/**
 * Union of all event_type values written to archive_event.
 * Add a new protocol's distinct event strings here when registering a new source.
 */
export type ArchiveEventType =
  | SharedGovernanceEventType
  | 'VoteCast'
  | 'DelegateChanged'
  | 'DelegateVotesChanged'
  | 'VotingActivated'
  | 'ProposalFailed'
  | 'PayloadSent';
