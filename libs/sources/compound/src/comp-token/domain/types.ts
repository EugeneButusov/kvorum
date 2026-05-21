export interface DelegateChangedPayload {
  delegator: string;
  fromDelegate: string;
  toDelegate: string;
}

export interface DelegateVotesChangedPayload {
  delegate: string;
  previousVotes: string;
  newVotes: string;
}

export type CompTokenEvent =
  | { type: 'DelegateChanged'; payload: DelegateChangedPayload }
  | { type: 'DelegateVotesChanged'; payload: DelegateVotesChangedPayload };
