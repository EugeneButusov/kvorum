import type { LogEvent } from '@libs/chain';
import { COMPOUND_COMP_TOKEN_INTERFACE, COMPOUND_COMP_TOKEN_TOPICS } from './events';
import { DecodeError } from '../../shared';
import type { CompTokenEvent } from '../domain/types';

export function decodeCompTokenLog(log: LogEvent): CompTokenEvent {
  const topic0 = log.topics[0]?.toLowerCase();
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };

  const knownTopics = Object.values(COMPOUND_COMP_TOKEN_TOPICS) as string[];
  if (!topic0 || !knownTopics.includes(topic0)) {
    throw new DecodeError('unknown_topic', undefined, logRef);
  }

  let parsed: ReturnType<typeof COMPOUND_COMP_TOKEN_INTERFACE.parseLog>;
  try {
    parsed = COMPOUND_COMP_TOKEN_INTERFACE.parseLog({ topics: log.topics, data: log.data });
  } catch (err) {
    throw new DecodeError('parse_failed', err, logRef);
  }

  /* v8 ignore next -- unreachable-guard: parseLog only returns null when topic is unknown, already guarded above */
  if (!parsed) {
    throw new DecodeError('parse_failed', new Error('parseLog returned null'), logRef);
  }

  switch (topic0) {
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

    /* v8 ignore next -- exhaustive-never: topic0 is validated against knownTopics above */
    default:
      throw new DecodeError('unknown_topic', undefined, logRef);
  }
}
