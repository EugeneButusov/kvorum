import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { interfaceForAragonVoting } from './events';
import type { AragonVotingEvent } from '../domain/types';

export function decodeAragonVotingLog(log: LogEvent, _sourceType: string): AragonVotingEvent {
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };
  const { iface, topics } = interfaceForAragonVoting();

  let parsed: ReturnType<typeof iface.parseLog>;
  try {
    parsed = iface.parseLog({ topics: log.topics, data: log.data });
  } catch (err) {
    throw new DecodeError('parse_failed', err, logRef);
  }

  if (!parsed) {
    throw new DecodeError('unknown_topic', undefined, logRef);
  }

  switch (parsed.fragment.topicHash.toLowerCase()) {
    case topics.StartVote:
      return {
        type: 'StartVote',
        payload: {
          voteId: (parsed.args['voteId'] as bigint).toString(),
          creator: (parsed.args['creator'] as string).toLowerCase(),
          metadata: parsed.args['metadata'] as string,
        },
      };
    case topics.CastVote:
      return {
        type: 'CastVote',
        payload: {
          voteId: (parsed.args['voteId'] as bigint).toString(),
          voter: (parsed.args['voter'] as string).toLowerCase(),
          supports: parsed.args['supports'] as boolean,
          stake: (parsed.args['stake'] as bigint).toString(),
        },
      };
    case topics.CastObjection:
      return {
        type: 'CastObjection',
        payload: {
          voteId: (parsed.args['voteId'] as bigint).toString(),
          voter: (parsed.args['voter'] as string).toLowerCase(),
          stake: (parsed.args['stake'] as bigint).toString(),
        },
      };
    case topics.ExecuteVote:
      return {
        type: 'ExecuteVote',
        payload: {
          voteId: (parsed.args['voteId'] as bigint).toString(),
        },
      };
    case topics.ChangeSupportRequired:
      return {
        type: 'ChangeSupportRequired',
        payload: {
          supportRequiredPct: (parsed.args['supportRequiredPct'] as bigint).toString(),
        },
      };
    case topics.ChangeMinQuorum:
      return {
        type: 'ChangeMinQuorum',
        payload: {
          minAcceptQuorumPct: (parsed.args['minAcceptQuorumPct'] as bigint).toString(),
        },
      };
    case topics.ChangeVoteTime:
      return {
        type: 'ChangeVoteTime',
        payload: {
          voteTime: (parsed.args['voteTime'] as bigint).toString(),
        },
      };
    case topics.ChangeObjectionPhaseTime:
      return {
        type: 'ChangeObjectionPhaseTime',
        payload: {
          objectionPhaseTime: (parsed.args['objectionPhaseTime'] as bigint).toString(),
        },
      };
    default:
      throw new DecodeError('unknown_topic', undefined, logRef);
  }
}
