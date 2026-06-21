import { Interface } from 'ethers';

// Vendored from the Lido two-phase Aragon fork implementation
// 0xf165148978Fa3cE74d76043f833463c340CFB704 (LIP-21, current as of ~Mar 2024).
// Three-era history: Era 1 has 6 events (no CastObjection/ChangeObjectionPhaseTime);
// Era 2 adds those two; Era 3 (LIP-21) adds delegate events (excluded from M4 scope).
const ARAGON_VOTING_EVENTS = [
  'event StartVote(uint256 indexed voteId, address indexed creator, string metadata)',
  'event CastVote(uint256 indexed voteId, address indexed voter, bool supports, uint256 stake)',
  'event CastObjection(uint256 indexed voteId, address indexed voter, uint256 stake)',
  'event ExecuteVote(uint256 indexed voteId)',
  'event ChangeSupportRequired(uint64 supportRequiredPct)',
  'event ChangeMinQuorum(uint64 minAcceptQuorumPct)',
  'event ChangeVoteTime(uint64 voteTime)',
  'event ChangeObjectionPhaseTime(uint64 objectionPhaseTime)',
] as const;

export const ARAGON_VOTING_INTERFACE = new Interface([...ARAGON_VOTING_EVENTS]);

function buildTopics(iface: Interface) {
  return {
    StartVote: iface.getEvent('StartVote')!.topicHash.toLowerCase(),
    CastVote: iface.getEvent('CastVote')!.topicHash.toLowerCase(),
    CastObjection: iface.getEvent('CastObjection')!.topicHash.toLowerCase(),
    ExecuteVote: iface.getEvent('ExecuteVote')!.topicHash.toLowerCase(),
    ChangeSupportRequired: iface.getEvent('ChangeSupportRequired')!.topicHash.toLowerCase(),
    ChangeMinQuorum: iface.getEvent('ChangeMinQuorum')!.topicHash.toLowerCase(),
    ChangeVoteTime: iface.getEvent('ChangeVoteTime')!.topicHash.toLowerCase(),
    ChangeObjectionPhaseTime: iface.getEvent('ChangeObjectionPhaseTime')!.topicHash.toLowerCase(),
  } as const;
}

export const ARAGON_VOTING_TOPICS = buildTopics(ARAGON_VOTING_INTERFACE);

export type AragonVotingTopics = ReturnType<typeof buildTopics>;

export function interfaceForAragonVoting(): {
  iface: Interface;
  topics: AragonVotingTopics;
} {
  return {
    iface: ARAGON_VOTING_INTERFACE,
    topics: ARAGON_VOTING_TOPICS,
  };
}
