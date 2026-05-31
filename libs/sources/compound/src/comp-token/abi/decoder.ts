import type { LogEvent } from '@libs/chain';
import { COMPOUND_COMP_TOKEN_INTERFACE, COMPOUND_COMP_TOKEN_TOPICS } from './events';
import { DecodeError } from '../../shared';
import type { CompTokenEvent } from '../domain/types';

export function decodeCompTokenLog(log: LogEvent): CompTokenEvent {
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };

  let parsed: ReturnType<typeof COMPOUND_COMP_TOKEN_INTERFACE.parseLog>;
  try {
    parsed = COMPOUND_COMP_TOKEN_INTERFACE.parseLog({ topics: log.topics, data: log.data });
  } catch (err) {
    throw new DecodeError('parse_failed', err, logRef);
  }

  if (!parsed) {
    throw new DecodeError('unknown_topic', undefined, logRef);
  }

  switch (parsed.fragment.topicHash.toLowerCase()) {
    case COMPOUND_COMP_TOKEN_TOPICS.DelegateChanged:
      return {
        type: 'DelegateChanged',
        payload: {
          delegator: (parsed.args['delegator'] as string).toLowerCase(),
          fromDelegate: (parsed.args['fromDelegate'] as string).toLowerCase(),
          toDelegate: (parsed.args['toDelegate'] as string).toLowerCase(),
        },
      };

    case COMPOUND_COMP_TOKEN_TOPICS.DelegateVotesChanged:
      return {
        type: 'DelegateVotesChanged',
        payload: {
          delegate: (parsed.args['delegate'] as string).toLowerCase(),
          previousVotes: (parsed.args['previousVotes'] as bigint).toString(),
          newVotes: (parsed.args['newVotes'] as bigint).toString(),
        },
      };

    default:
      throw new DecodeError('unknown_topic', undefined, logRef);
  }
}
