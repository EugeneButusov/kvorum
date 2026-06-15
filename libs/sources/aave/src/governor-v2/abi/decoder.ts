import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { interfaceForAaveGovernorV2 } from './events';
import type { AaveGovernorV2Event } from '../domain/types';

export function decodeAaveGovernorV2Log(log: LogEvent, _sourceType: string): AaveGovernorV2Event {
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };
  const { iface, topics } = interfaceForAaveGovernorV2();

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
          id: (parsed.args['id'] as bigint).toString(),
          creator: (parsed.args['creator'] as string).toLowerCase(),
          executor: (parsed.args['executor'] as string).toLowerCase(),
          targets: (parsed.args['targets'] as string[]).map((t) => t.toLowerCase()),
          values: (parsed.args.getValue('values') as bigint[]).map((v) => v.toString()),
          signatures: parsed.args['signatures'] as string[],
          calldatas: parsed.args['calldatas'] as string[],
          withDelegatecalls: parsed.args['withDelegatecalls'] as boolean[],
          startBlock: (parsed.args['startBlock'] as bigint).toString(),
          endBlock: (parsed.args['endBlock'] as bigint).toString(),
          strategy: (parsed.args['strategy'] as string).toLowerCase(),
          ipfsHash: parsed.args['ipfsHash'] as string,
        },
      };
    case topics.VoteEmitted:
      return {
        type: 'VoteEmitted',
        payload: {
          id: (parsed.args['id'] as bigint).toString(),
          voter: (parsed.args['voter'] as string).toLowerCase(),
          support: parsed.args['support'] as boolean,
          votingPower: (parsed.args['votingPower'] as bigint).toString(),
        },
      };
    case topics.ProposalQueued:
      return {
        type: 'ProposalQueued',
        payload: {
          id: (parsed.args['id'] as bigint).toString(),
          executionTime: (parsed.args['executionTime'] as bigint).toString(),
        },
      };
    case topics.ProposalExecuted:
      return {
        type: 'ProposalExecuted',
        payload: {
          id: (parsed.args['id'] as bigint).toString(),
        },
      };
    case topics.ProposalCanceled:
      return {
        type: 'ProposalCanceled',
        payload: {
          id: (parsed.args['id'] as bigint).toString(),
        },
      };
    default:
      throw new DecodeError('unknown_topic', undefined, logRef);
  }
}
