export interface DelegateChangedPayload {
  delegator: string;
  delegatee: string;
  // GovernancePowerType (uint8): 0 = VOTING, 1 = PROPOSITION.
  delegationType: number;
}

export type AaveTokenEvent = { type: 'DelegateChanged'; payload: DelegateChangedPayload };
