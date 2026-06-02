import { Interface } from 'ethers';

const DELEGATE_CHANGED =
  'event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate)';
const DELEGATE_VOTES_CHANGED =
  'event DelegateVotesChanged(address indexed delegate, uint256 previousVotes, uint256 newVotes)';

export const COMPOUND_COMP_TOKEN_INTERFACE = new Interface([
  DELEGATE_CHANGED,
  DELEGATE_VOTES_CHANGED,
]);

export const COMPOUND_COMP_TOKEN_TOPICS = {
  DelegateChanged:
    COMPOUND_COMP_TOKEN_INTERFACE.getEvent('DelegateChanged')!.topicHash.toLowerCase(),
  DelegateVotesChanged:
    COMPOUND_COMP_TOKEN_INTERFACE.getEvent('DelegateVotesChanged')!.topicHash.toLowerCase(),
} as const;

export type { TokenDelegationEventType as CompTokenEventType } from '@libs/domain';
