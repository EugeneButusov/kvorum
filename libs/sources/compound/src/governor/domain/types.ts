export interface ProposalCreatedPayload {
  proposalId: string; // uint256 → decimal string
  proposer: string; // 0x… lowercased
  targets: string[]; // each lowercased
  values: string[]; // uint256 → decimal string each
  signatures: string[];
  calldatas: string[]; // 0x… hex
  startBlock: string; // uint256 → decimal string
  endBlock: string; // uint256 → decimal string
  description: string;
}

export interface ProposalQueuedPayload {
  proposalId: string;
  eta: string;
}

export interface ProposalExecutedPayload {
  proposalId: string;
}

export interface ProposalCanceledPayload {
  proposalId: string;
}

export interface VoteCastPayload {
  voter: string;
  proposalId: string;
  primaryChoice: number;
  votingPowerReported: string;
  compound: {
    supportRaw: boolean | number;
    reason: string | null;
  };
}

export type CompoundGovernorEvent =
  | { type: 'ProposalCreated'; payload: ProposalCreatedPayload }
  | { type: 'ProposalQueued'; payload: ProposalQueuedPayload }
  | { type: 'ProposalExecuted'; payload: ProposalExecutedPayload }
  | { type: 'ProposalCanceled'; payload: ProposalCanceledPayload }
  | { type: 'VoteCast'; payload: VoteCastPayload };
