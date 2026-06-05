export interface VoteEmittedPayload {
  proposalId: string;
  voter: string;
  support: boolean;
  votingPower: string;
}

export interface ProposalVoteStartedPayload {
  proposalId: string;
  l1BlockHash: string;
  startTime: string;
  endTime: string;
}

export interface ProposalResultsSentPayload {
  proposalId: string;
  forVotes: string;
  againstVotes: string;
}

export interface ProposalVoteConfigurationBridgedPayload {
  proposalId: string;
  blockHash: string;
  votingDuration: number;
  voteCreated: boolean;
}

export type AaveVotingMachineEvent =
  | { type: 'VoteEmitted'; payload: VoteEmittedPayload }
  | { type: 'ProposalVoteStarted'; payload: ProposalVoteStartedPayload }
  | { type: 'ProposalResultsSent'; payload: ProposalResultsSentPayload }
  | {
      type: 'ProposalVoteConfigurationBridged';
      payload: ProposalVoteConfigurationBridgedPayload;
    };
