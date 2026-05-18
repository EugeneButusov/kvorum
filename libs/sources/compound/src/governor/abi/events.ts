import { Interface } from 'ethers';

export const COMPOUND_GOVERNOR_EVENTS = [
  'event ProposalCreated(uint256 id, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
  'event ProposalQueued(uint256 id, uint256 eta)',
  'event ProposalExecuted(uint256 id)',
  'event ProposalCanceled(uint256 id)',
] as const;

export const COMPOUND_GOVERNOR_INTERFACE = new Interface(COMPOUND_GOVERNOR_EVENTS);

// Pre-computed topic0s (keccak256 of the canonical event signature). Lowercased.
// Computed at module load via Interface.getEvent(name).topicHash; cached as constants
// for EventPoller filter composition + decoder dispatch.
export const COMPOUND_EVENT_TOPICS = {
  ProposalCreated: COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalCreated')!.topicHash.toLowerCase(),
  ProposalQueued: COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalQueued')!.topicHash.toLowerCase(),
  ProposalExecuted:
    COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalExecuted')!.topicHash.toLowerCase(),
  ProposalCanceled:
    COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalCanceled')!.topicHash.toLowerCase(),
} as const;

export type CompoundEventType = keyof typeof COMPOUND_EVENT_TOPICS;
