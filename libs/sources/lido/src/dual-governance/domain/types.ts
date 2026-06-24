// Decoded Dual Governance event union. Payloads hold archive-faithful primitives: addresses
// lowercased, uints as decimal strings, bytes as 0x-hex, State enum mapped to its name.
//
// Two sources feed this union: the DualGovernance contract (governance + state-machine layer) and the
// EmergencyProtectedTimelock (proposal-execution layer). The two `ProposalSubmitted` events are
// disambiguated as `ProposalSubmittedMeta` (DG, carries proposer + metadata) vs `ProposalSubmitted`
// (Timelock, carries the calls). They share `proposalId`; AB3 reconciles.

export interface ExternalCall {
  target: string;
  value: string;
  payload: string;
}

/** Mirror of the on-chain `Context` struct carried by DualGovernanceStateChanged. */
export interface DualGovernanceStateContext {
  state: string;
  enteredAt: number;
  vetoSignallingActivatedAt: number;
  signallingEscrow: string;
  rageQuitRound: number;
  vetoSignallingReactivationTime: number;
  normalOrVetoCooldownExitedAt: number;
  rageQuitEscrow: string;
  configProvider: string;
}

export interface DualGovernanceStateChangedPayload {
  from: string;
  to: string;
  context: DualGovernanceStateContext;
}

export interface NewSignallingEscrowDeployedPayload {
  escrow: string;
}

export interface EscrowMasterCopyDeployedPayload {
  escrowMasterCopy: string;
}

export interface ConfigProviderSetPayload {
  newConfigProvider: string;
}

export interface ProposalSubmittedMetaPayload {
  proposerAccount: string;
  proposalId: string;
  metadata: string;
}

export interface ProposalsCancellerSetPayload {
  proposalsCanceller: string;
}

export interface ProposerPayload {
  proposerAccount: string;
  executor: string;
}

export interface TimelockProposalSubmittedPayload {
  id: string;
  executor: string;
  calls: ExternalCall[];
}

export interface TimelockProposalIdPayload {
  id: string;
}

// Bulk cancel: every non-executed proposal with id <= proposalId is cancelled. Archived as a single
// boundary-carrying row; the range is interpreted in derivation (AB3), not expanded here.
export interface ProposalsCancelledTillPayload {
  proposalId: string;
}

export type DualGovernanceEvent =
  | { type: 'DualGovernanceStateChanged'; payload: DualGovernanceStateChangedPayload }
  | { type: 'NewSignallingEscrowDeployed'; payload: NewSignallingEscrowDeployedPayload }
  | { type: 'EscrowMasterCopyDeployed'; payload: EscrowMasterCopyDeployedPayload }
  | { type: 'ConfigProviderSet'; payload: ConfigProviderSetPayload }
  | { type: 'ProposalSubmittedMeta'; payload: ProposalSubmittedMetaPayload }
  | { type: 'ProposalsCancellerSet'; payload: ProposalsCancellerSetPayload }
  | { type: 'CancelAllPendingProposalsExecuted'; payload: Record<string, never> }
  | { type: 'CancelAllPendingProposalsSkipped'; payload: Record<string, never> }
  | { type: 'ProposerRegistered'; payload: ProposerPayload }
  | { type: 'ProposerExecutorSet'; payload: ProposerPayload }
  | { type: 'ProposerUnregistered'; payload: ProposerPayload }
  | { type: 'ProposalSubmitted'; payload: TimelockProposalSubmittedPayload }
  | { type: 'ProposalScheduled'; payload: TimelockProposalIdPayload }
  | { type: 'ProposalExecuted'; payload: TimelockProposalIdPayload }
  | { type: 'ProposalsCancelledTill'; payload: ProposalsCancelledTillPayload }
  | { type: 'EmergencyModeActivated'; payload: Record<string, never> }
  | { type: 'EmergencyModeDeactivated'; payload: Record<string, never> };

export type DualGovernanceEventType = DualGovernanceEvent['type'];
