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

// Proposal-level read extensions only (ADR-0069 scope guard).
// Vote/delegation/actor extensions are out of scope and need their own decision.
export interface SourceApiContribution {
  readonly sourceTypes: readonly string[];
  choiceBounds(sourceType: string): ChoiceBounds;
  getProposalExtension(proposalId: string, sourceType: string): Promise<ProposalExtension | null>;
}
