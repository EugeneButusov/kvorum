import { Interface } from 'ethers';

// AaveTokenV3 (BaseDelegation / GovernancePowerDelegationERC20 V3). Only DelegateChanged is
// emitted: V3 deliberately removed DelegatedPowerChanged ("Transfer + DelegateChanged suffice
// to reconstruct state"). delegationType is the GovernancePowerType enum (uint8): VOTING=0,
// PROPOSITION=1. Undelegation/self-delegation is normalized to address(0) before emission.
const DELEGATE_CHANGED =
  'event DelegateChanged(address indexed delegator, address indexed delegatee, uint8 delegationType)';

export const AAVE_TOKEN_INTERFACE = new Interface([DELEGATE_CHANGED]);

export const AAVE_TOKEN_TOPICS = {
  DelegateChanged: AAVE_TOKEN_INTERFACE.getEvent('DelegateChanged')!.topicHash.toLowerCase(),
} as const;

// GovernancePowerType enum values (uint8) carried by DelegateChanged.delegationType.
export const AAVE_GOVERNANCE_POWER_TYPE = {
  VOTING: 0,
  PROPOSITION: 1,
} as const;

export type AaveTokenEventType = 'DelegateChanged';
