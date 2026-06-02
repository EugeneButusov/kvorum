import { Interface } from 'ethers';

const PROPOSAL_EVENTS = [
  'event ProposalCreated(uint256 id, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
  'event ProposalQueued(uint256 id, uint256 eta)',
  'event ProposalExecuted(uint256 id)',
  'event ProposalCanceled(uint256 id)',
] as const;

const ALPHA_VOTECAST =
  'event VoteCast(address voter, uint256 proposalId, bool support, uint256 votes)';
const BRAVO_VOTECAST =
  'event VoteCast(address voter, uint256 proposalId, uint8 support, uint256 votes, string reason)';
const OZ_VOTECAST =
  'event VoteCast(address voter, uint256 proposalId, uint8 support, uint256 weight, string reason)';

export const COMPOUND_GOVERNOR_ALPHA_INTERFACE = new Interface([
  ...PROPOSAL_EVENTS,
  ALPHA_VOTECAST,
]);
export const COMPOUND_GOVERNOR_BRAVO_INTERFACE = new Interface([
  ...PROPOSAL_EVENTS,
  BRAVO_VOTECAST,
]);
export const COMPOUND_GOVERNOR_OZ_INTERFACE = new Interface([...PROPOSAL_EVENTS, OZ_VOTECAST]);

function buildTopics(iface: Interface) {
  return {
    ProposalCreated: iface.getEvent('ProposalCreated')!.topicHash.toLowerCase(),
    ProposalQueued: iface.getEvent('ProposalQueued')!.topicHash.toLowerCase(),
    ProposalExecuted: iface.getEvent('ProposalExecuted')!.topicHash.toLowerCase(),
    ProposalCanceled: iface.getEvent('ProposalCanceled')!.topicHash.toLowerCase(),
    VoteCast: iface.getEvent('VoteCast')!.topicHash.toLowerCase(),
  } as const;
}

export const COMPOUND_ALPHA_TOPICS = buildTopics(COMPOUND_GOVERNOR_ALPHA_INTERFACE);
export const COMPOUND_BRAVO_TOPICS = buildTopics(COMPOUND_GOVERNOR_BRAVO_INTERFACE);
export const COMPOUND_OZ_TOPICS = buildTopics(COMPOUND_GOVERNOR_OZ_INTERFACE);

export type CompoundGovernorVariant =
  | 'compound_governor_alpha'
  | 'compound_governor_bravo'
  | 'compound_governor_oz';

import type { SharedGovernanceEventType } from '@libs/domain';
export type CompoundEventType = SharedGovernanceEventType | 'VoteCast';

export type CompoundTopics = ReturnType<typeof buildTopics>;

export function interfaceForSource(sourceType: string): {
  iface: Interface;
  topics: CompoundTopics;
  variant: CompoundGovernorVariant;
} {
  switch (sourceType) {
    case 'compound_governor_alpha':
      return {
        iface: COMPOUND_GOVERNOR_ALPHA_INTERFACE,
        topics: COMPOUND_ALPHA_TOPICS,
        variant: 'compound_governor_alpha',
      };
    case 'compound_governor_bravo':
      return {
        iface: COMPOUND_GOVERNOR_BRAVO_INTERFACE,
        topics: COMPOUND_BRAVO_TOPICS,
        variant: 'compound_governor_bravo',
      };
    case 'compound_governor_oz':
      return {
        iface: COMPOUND_GOVERNOR_OZ_INTERFACE,
        topics: COMPOUND_OZ_TOPICS,
        variant: 'compound_governor_oz',
      };
    default:
      throw new Error(`interfaceForSource: unsupported sourceType=${sourceType}`);
  }
}
