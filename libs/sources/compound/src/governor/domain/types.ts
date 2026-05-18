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

export type CompoundGovernorEvent =
  | { type: 'ProposalCreated'; payload: ProposalCreatedPayload }
  | { type: 'ProposalQueued'; payload: ProposalQueuedPayload }
  | { type: 'ProposalExecuted'; payload: ProposalExecutedPayload }
  | { type: 'ProposalCanceled'; payload: ProposalCanceledPayload };

export class DecodeError extends Error {
  constructor(
    public readonly reason: 'unknown_topic' | 'parse_failed' | 'wrong_address',
    // cause is a built-in property on Error in ES2022; use a different name to avoid override conflict
    public readonly decodeSource: unknown,
    public readonly logRef: { txHash: string; logIndex: number; blockHash: string },
  ) {
    super(`decode failed: ${reason}`);
    this.name = 'DecodeError';
  }
}
