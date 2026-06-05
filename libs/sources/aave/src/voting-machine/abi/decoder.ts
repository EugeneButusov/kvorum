import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { interfaceForAaveVotingMachine } from './events';
import type { AaveVotingMachineEvent } from '../domain/types';

export function decodeAaveVotingMachineLog(
  log: LogEvent,
  _sourceType: string,
): AaveVotingMachineEvent {
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };
  const { iface, topics } = interfaceForAaveVotingMachine();

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
    case topics.VoteEmitted:
      return {
        type: 'VoteEmitted',
        payload: {
          proposalId: (parsed.args['proposalId'] as bigint).toString(),
          voter: (parsed.args['voter'] as string).toLowerCase(),
          support: parsed.args['support'] as boolean,
          votingPower: (parsed.args['votingPower'] as bigint).toString(),
        },
      };
    case topics.ProposalVoteStarted:
      return {
        type: 'ProposalVoteStarted',
        payload: {
          proposalId: (parsed.args['proposalId'] as bigint).toString(),
          l1BlockHash: parsed.args['l1BlockHash'] as string,
          startTime: (parsed.args['startTime'] as bigint).toString(),
          endTime: (parsed.args['endTime'] as bigint).toString(),
        },
      };
    case topics.ProposalResultsSent:
      return {
        type: 'ProposalResultsSent',
        payload: {
          proposalId: (parsed.args['proposalId'] as bigint).toString(),
          forVotes: (parsed.args['forVotes'] as bigint).toString(),
          againstVotes: (parsed.args['againstVotes'] as bigint).toString(),
        },
      };
    case topics.ProposalVoteConfigurationBridged:
      return {
        type: 'ProposalVoteConfigurationBridged',
        payload: {
          proposalId: (parsed.args['proposalId'] as bigint).toString(),
          blockHash: parsed.args['blockHash'] as string,
          votingDuration: Number(parsed.args['votingDuration']),
          voteCreated: parsed.args['voteCreated'] as boolean,
        },
      };
    default:
      throw new DecodeError('unknown_topic', undefined, logRef);
  }
}
