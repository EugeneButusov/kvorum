export interface V2ProposalCreatedPayload {
  id: string;
  creator: string;
  executor: string;
  targets: string[];
  values: string[];
  signatures: string[];
  calldatas: string[];
  withDelegatecalls: boolean[];
  startBlock: string;
  endBlock: string;
  strategy: string;
  ipfsHash: string;
}

export interface V2VoteEmittedPayload {
  id: string;
  voter: string;
  support: boolean;
  votingPower: string;
}

export interface V2ProposalQueuedPayload {
  id: string;
  executionTime: string;
}

export interface V2ProposalExecutedPayload {
  id: string;
}

export interface V2ProposalCanceledPayload {
  id: string;
}

export type AaveGovernorV2Event =
  | { type: 'ProposalCreated'; payload: V2ProposalCreatedPayload }
  | { type: 'VoteEmitted'; payload: V2VoteEmittedPayload }
  | { type: 'ProposalQueued'; payload: V2ProposalQueuedPayload }
  | { type: 'ProposalExecuted'; payload: V2ProposalExecutedPayload }
  | { type: 'ProposalCanceled'; payload: V2ProposalCanceledPayload };
