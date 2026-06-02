import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { interfaceForAaveGovernanceV3 } from './events';
import type { AaveGovernanceV3Event } from '../domain/types';

export function decodeAaveGovernanceV3Log(
  log: LogEvent,
  _sourceType: string,
): AaveGovernanceV3Event {
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };
  const { iface, topics } = interfaceForAaveGovernanceV3();

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
    case topics.ProposalCreated:
      return {
        type: 'ProposalCreated',
        payload: {
          proposalId: (parsed.args['proposalId'] as bigint).toString(),
          creator: (parsed.args['creator'] as string).toLowerCase(),
          accessLevel: Number(parsed.args['accessLevel']),
          ipfsHash: parsed.args['ipfsHash'] as string,
        },
      };
    case topics.VotingActivated:
      return {
        type: 'VotingActivated',
        payload: {
          proposalId: (parsed.args['proposalId'] as bigint).toString(),
          snapshotBlockHash: parsed.args['snapshotBlockHash'] as string,
          votingDuration: Number(parsed.args['votingDuration']),
        },
      };
    case topics.ProposalQueued:
      return {
        type: 'ProposalQueued',
        payload: {
          proposalId: (parsed.args['proposalId'] as bigint).toString(),
          votesFor: (parsed.args['votesFor'] as bigint).toString(),
          votesAgainst: (parsed.args['votesAgainst'] as bigint).toString(),
        },
      };
    case topics.ProposalExecuted:
      return {
        type: 'ProposalExecuted',
        payload: {
          proposalId: (parsed.args['proposalId'] as bigint).toString(),
        },
      };
    case topics.ProposalCanceled:
      return {
        type: 'ProposalCanceled',
        payload: {
          proposalId: (parsed.args['proposalId'] as bigint).toString(),
        },
      };
    case topics.ProposalFailed:
      return {
        type: 'ProposalFailed',
        payload: {
          proposalId: (parsed.args['proposalId'] as bigint).toString(),
          votesFor: (parsed.args['votesFor'] as bigint).toString(),
          votesAgainst: (parsed.args['votesAgainst'] as bigint).toString(),
        },
      };
    case topics.PayloadSent:
      return {
        type: 'PayloadSent',
        payload: {
          proposalId: (parsed.args['proposalId'] as bigint).toString(),
          payloadId: (parsed.args['payloadId'] as bigint).toString(),
          payloadsController: (parsed.args['payloadsController'] as string).toLowerCase(),
          chainId: (parsed.args['chainId'] as bigint).toString(),
          payloadNumberOnProposal: (parsed.args['payloadNumberOnProposal'] as bigint).toString(),
          numberOfPayloadsOnProposal: (
            parsed.args['numberOfPayloadsOnProposal'] as bigint
          ).toString(),
        },
      };
    default:
      throw new DecodeError('unknown_topic', undefined, logRef);
  }
}
