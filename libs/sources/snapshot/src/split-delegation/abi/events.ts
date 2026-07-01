import { Interface } from 'ethers';

// Gnosis Guild "Split Delegation". `context` (the space) is a STRING carried in event DATA,
// NOT indexed — so it is not topic-filterable; the archive consumer drops events whose decoded
// context is outside the seeded spaces. Delegation is `{ bytes32 delegate, uint256 ratio }[]`
// (multi-delegate, weighted) with an expiration timestamp.
const DELEGATION_UPDATED =
  'event DelegationUpdated(address indexed account, string context, (bytes32 delegate, uint256 ratio)[] previousDelegation, (bytes32 delegate, uint256 ratio)[] delegation, uint256 expirationTimestamp)';
const DELEGATION_CLEARED =
  'event DelegationCleared(address indexed account, string context, (bytes32 delegate, uint256 ratio)[] delegatesCleared)';
const EXPIRATION_UPDATED =
  'event ExpirationUpdated(address indexed account, string context, (bytes32 delegate, uint256 ratio)[] delegation, uint256 expirationTimestamp)';
const OPT_OUT_STATUS_SET =
  'event OptOutStatusSet(address indexed delegate, string context, bool optout)';

export const SPLIT_DELEGATION_INTERFACE = new Interface([
  DELEGATION_UPDATED,
  DELEGATION_CLEARED,
  EXPIRATION_UPDATED,
  OPT_OUT_STATUS_SET,
]);

export const SPLIT_DELEGATION_TOPICS = {
  DelegationUpdated:
    SPLIT_DELEGATION_INTERFACE.getEvent('DelegationUpdated')!.topicHash.toLowerCase(),
  DelegationCleared:
    SPLIT_DELEGATION_INTERFACE.getEvent('DelegationCleared')!.topicHash.toLowerCase(),
  ExpirationUpdated:
    SPLIT_DELEGATION_INTERFACE.getEvent('ExpirationUpdated')!.topicHash.toLowerCase(),
  OptOutStatusSet: SPLIT_DELEGATION_INTERFACE.getEvent('OptOutStatusSet')!.topicHash.toLowerCase(),
} as const;

export type SplitDelegationEventType =
  | 'DelegationUpdated'
  | 'DelegationCleared'
  | 'ExpirationUpdated'
  | 'OptOutStatusSet';
