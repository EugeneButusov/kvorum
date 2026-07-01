// One weighted delegate within a Split Delegation. `delegate` is a bytes32 id (EVM address
// left-zero-padded); `ratio` is a raw uint256 weight (decimal string).
export interface SplitDelegationEntry {
  delegate: string;
  ratio: string;
}

export type SplitDelegationEvent =
  | {
      type: 'DelegationUpdated';
      payload: {
        account: string;
        context: string;
        delegation: SplitDelegationEntry[];
        expirationTimestamp: string;
      };
    }
  | { type: 'DelegationCleared'; payload: { account: string; context: string } }
  | {
      type: 'ExpirationUpdated';
      payload: {
        account: string;
        context: string;
        delegation: SplitDelegationEntry[];
        expirationTimestamp: string;
      };
    }
  | { type: 'OptOutStatusSet'; payload: { delegate: string; context: string; optout: boolean } };

export type SplitDelegationEventType = SplitDelegationEvent['type'];
