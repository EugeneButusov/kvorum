import { Interface } from 'ethers';

const GOVERNANCE_V3_EVENTS = [
  'event ProposalCreated(uint256 indexed proposalId, address indexed creator, uint8 indexed accessLevel, bytes32 ipfsHash)',
  'event VotingActivated(uint256 indexed proposalId, bytes32 indexed snapshotBlockHash, uint24 votingDuration)',
  'event ProposalQueued(uint256 indexed proposalId, uint128 votesFor, uint128 votesAgainst)',
  'event ProposalExecuted(uint256 indexed proposalId)',
  'event ProposalCanceled(uint256 indexed proposalId)',
  'event ProposalFailed(uint256 indexed proposalId, uint128 votesFor, uint128 votesAgainst)',
  'event PayloadSent(uint256 indexed proposalId, uint40 payloadId, address indexed payloadsController, uint256 indexed chainId, uint256 payloadNumberOnProposal, uint256 numberOfPayloadsOnProposal)',
] as const;

export const AAVE_GOVERNANCE_V3_INTERFACE = new Interface([...GOVERNANCE_V3_EVENTS]);

function buildTopics(iface: Interface) {
  return {
    ProposalCreated: iface.getEvent('ProposalCreated')!.topicHash.toLowerCase(),
    VotingActivated: iface.getEvent('VotingActivated')!.topicHash.toLowerCase(),
    ProposalQueued: iface.getEvent('ProposalQueued')!.topicHash.toLowerCase(),
    ProposalExecuted: iface.getEvent('ProposalExecuted')!.topicHash.toLowerCase(),
    ProposalCanceled: iface.getEvent('ProposalCanceled')!.topicHash.toLowerCase(),
    ProposalFailed: iface.getEvent('ProposalFailed')!.topicHash.toLowerCase(),
    PayloadSent: iface.getEvent('PayloadSent')!.topicHash.toLowerCase(),
  } as const;
}

export const AAVE_GOVERNANCE_V3_TOPICS = buildTopics(AAVE_GOVERNANCE_V3_INTERFACE);

import type { SharedGovernanceEventType } from '@libs/domain';
export type AaveGovernanceV3EventType =
  | SharedGovernanceEventType
  | 'VotingActivated'
  | 'ProposalFailed'
  | 'PayloadSent';

export type AaveGovernanceV3Topics = ReturnType<typeof buildTopics>;

export function interfaceForAaveGovernanceV3(): {
  iface: Interface;
  topics: AaveGovernanceV3Topics;
} {
  return {
    iface: AAVE_GOVERNANCE_V3_INTERFACE,
    topics: AAVE_GOVERNANCE_V3_TOPICS,
  };
}
