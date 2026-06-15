import { Interface } from 'ethers';

const GOVERNOR_V2_EVENTS = [
  'event ProposalCreated(uint256 id, address indexed creator, address indexed executor, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, bool[] withDelegatecalls, uint256 startBlock, uint256 endBlock, address strategy, bytes32 ipfsHash)',
  'event VoteEmitted(uint256 id, address indexed voter, bool support, uint256 votingPower)',
  'event ProposalQueued(uint256 id, uint256 executionTime, address indexed initiatorQueueing)',
  'event ProposalExecuted(uint256 id, address indexed initiatorExecution)',
  'event ProposalCanceled(uint256 id)',
] as const;

export const AAVE_GOVERNOR_V2_INTERFACE = new Interface([...GOVERNOR_V2_EVENTS]);

function buildTopics(iface: Interface) {
  return {
    ProposalCreated: iface.getEvent('ProposalCreated')!.topicHash.toLowerCase(),
    VoteEmitted: iface.getEvent('VoteEmitted')!.topicHash.toLowerCase(),
    ProposalQueued: iface.getEvent('ProposalQueued')!.topicHash.toLowerCase(),
    ProposalExecuted: iface.getEvent('ProposalExecuted')!.topicHash.toLowerCase(),
    ProposalCanceled: iface.getEvent('ProposalCanceled')!.topicHash.toLowerCase(),
  } as const;
}

export const AAVE_GOVERNOR_V2_TOPICS = buildTopics(AAVE_GOVERNOR_V2_INTERFACE);

export type AaveGovernorV2EventType =
  | 'ProposalCreated'
  | 'VoteEmitted'
  | 'ProposalQueued'
  | 'ProposalExecuted'
  | 'ProposalCanceled';

export type AaveGovernorV2Topics = ReturnType<typeof buildTopics>;

export function interfaceForAaveGovernorV2(): {
  iface: Interface;
  topics: AaveGovernorV2Topics;
} {
  return {
    iface: AAVE_GOVERNOR_V2_INTERFACE,
    topics: AAVE_GOVERNOR_V2_TOPICS,
  };
}
