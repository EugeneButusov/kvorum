export interface ChoiceBounds {
  min: number;
  max: number;
}

export interface ProposalPayloadView {
  payload_index: number;
  target_chain_id: string;
  payloads_controller_address: string;
  payload_id: string;
  status: 'declared' | 'created' | 'queued' | 'executed' | 'cancelled' | 'expired';
  executed_at_destination: string | null; // ISO seconds
  unindexed_target_chain: boolean;
}

export interface ProposalVotingView {
  voting_chain_id: string | null;
  voting_machine_address: string | null;
  voting_strategy_address: string | null;
  creation_block: string;
}

export interface ProposalExtension {
  voting: ProposalVotingView | null;
  payloads: readonly ProposalPayloadView[];
}

// Source-wide delegation semantics. 'relationship-only' sources (e.g. Aave governance)
// emit delegation events with voting_power='0' by design; 'power-bearing' sources
// (e.g. Compound comp-token) carry actual voting power on each delegation row.
export type DelegationModel = 'relationship-only' | 'power-bearing';

// Reserved per-entity extension surfaces (no fields yet). Type aliases rather than
// empty interfaces — `interface X {}` trips @typescript-eslint/no-empty-object-type.
export type VoteExtension = Record<string, never>;
export type DelegationExtension = Record<string, never>;

// Per-source read contributions spanning proposals, votes, and delegations (ADR-0069,
// amended 2026-06-17 to lift the proposal-only scope guard). Carried on SourcePlugin
// and aggregated into the SOURCE_API_CONTRIBUTIONS collection; dispatched via the pure
// source-blind helpers in ./source-api-resolve.
export interface SourceApiContribution {
  readonly sourceTypes: readonly string[];
  choiceBounds(sourceType: string): ChoiceBounds;
  delegationModel(sourceType: string): DelegationModel;
  getProposalExtension(proposalId: string, sourceType: string): Promise<ProposalExtension | null>;
  getVoteExtension?(voteId: string, sourceType: string): Promise<VoteExtension | null>;
  getDelegationExtension?(
    delegationId: string,
    sourceType: string,
  ): Promise<DelegationExtension | null>;
}
