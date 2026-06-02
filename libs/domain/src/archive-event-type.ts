/** Events emitted by multiple on-chain governance protocols (shared proposal lifecycle). */
export type SharedGovernanceEventType =
  | 'ProposalCreated'
  | 'ProposalQueued'
  | 'ProposalExecuted'
  | 'ProposalCanceled';

/** Compound Governor (Alpha / Bravo / OZ) — shared lifecycle + VoteCast. */
export type CompoundGovernorEventType = SharedGovernanceEventType | 'VoteCast';

/** ERC20Votes-style token delegation events (COMP token, future OZ tokens). */
export type TokenDelegationEventType = 'DelegateChanged' | 'DelegateVotesChanged';

/** Aave Governance v3 — shared lifecycle + v3-specific events. */
export type AaveGovernanceV3EventType =
  | SharedGovernanceEventType
  | 'VotingActivated'
  | 'ProposalFailed'
  | 'PayloadSent';

/**
 * Union of all event_type values written to archive_event.
 * Add a new protocol's types here when registering a new source.
 */
export type ArchiveEventType =
  | CompoundGovernorEventType
  | TokenDelegationEventType
  | AaveGovernanceV3EventType;
