export interface ProposalCreatedPayload {
  proposalId: string;
  creator: string;
  accessLevel: number;
  ipfsHash: string;
}

export interface VotingActivatedPayload {
  proposalId: string;
  votingDuration: number;
}

export interface ProposalQueuedPayload {
  proposalId: string;
  votesFor: string;
  votesAgainst: string;
}

export interface ProposalExecutedPayload {
  proposalId: string;
}

export interface ProposalCanceledPayload {
  proposalId: string;
}

export interface ProposalFailedPayload {
  proposalId: string;
  votesFor: string;
  votesAgainst: string;
}

export interface PayloadSentPayload {
  proposalId: string;
  payloadId: string;
  payloadsController: string;
  chainId: string;
  payloadNumberOnProposal: string;
  numberOfPayloadsOnProposal: string;
}

export type AaveGovernanceV3Event =
  | { type: 'ProposalCreated'; payload: ProposalCreatedPayload }
  | { type: 'VotingActivated'; payload: VotingActivatedPayload }
  | { type: 'ProposalQueued'; payload: ProposalQueuedPayload }
  | { type: 'ProposalExecuted'; payload: ProposalExecutedPayload }
  | { type: 'ProposalCanceled'; payload: ProposalCanceledPayload }
  | { type: 'ProposalFailed'; payload: ProposalFailedPayload }
  | { type: 'PayloadSent'; payload: PayloadSentPayload };
