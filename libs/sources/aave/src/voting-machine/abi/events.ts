import { Interface } from 'ethers';

const VOTING_MACHINE_EVENTS = [
  'event VoteEmitted(uint256 indexed proposalId, address indexed voter, bool indexed support, uint256 votingPower)',
  'event ProposalVoteStarted(uint256 indexed proposalId, bytes32 indexed l1BlockHash, uint256 startTime, uint256 endTime)',
  'event ProposalResultsSent(uint256 indexed proposalId, uint256 forVotes, uint256 againstVotes)',
  'event ProposalVoteConfigurationBridged(uint256 indexed proposalId, bytes32 indexed blockHash, uint24 votingDuration, bool indexed voteCreated)',
] as const;

export const AAVE_VOTING_MACHINE_INTERFACE = new Interface([...VOTING_MACHINE_EVENTS]);

function buildTopics(iface: Interface) {
  return {
    VoteEmitted: iface.getEvent('VoteEmitted')!.topicHash.toLowerCase(),
    ProposalVoteStarted: iface.getEvent('ProposalVoteStarted')!.topicHash.toLowerCase(),
    ProposalResultsSent: iface.getEvent('ProposalResultsSent')!.topicHash.toLowerCase(),
    ProposalVoteConfigurationBridged: iface
      .getEvent('ProposalVoteConfigurationBridged')!
      .topicHash.toLowerCase(),
  } as const;
}

export const AAVE_VOTING_MACHINE_TOPICS = buildTopics(AAVE_VOTING_MACHINE_INTERFACE);

export type AaveVotingMachineEventType =
  | 'VoteEmitted'
  | 'ProposalVoteStarted'
  | 'ProposalResultsSent'
  | 'ProposalVoteConfigurationBridged';

export type AaveVotingMachineTopics = ReturnType<typeof buildTopics>;

export function interfaceForAaveVotingMachine(): {
  iface: Interface;
  topics: AaveVotingMachineTopics;
} {
  return {
    iface: AAVE_VOTING_MACHINE_INTERFACE,
    topics: AAVE_VOTING_MACHINE_TOPICS,
  };
}
