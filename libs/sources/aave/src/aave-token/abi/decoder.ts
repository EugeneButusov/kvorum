import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { AAVE_TOKEN_INTERFACE, AAVE_TOKEN_TOPICS } from './events';
import type { AaveTokenEvent } from '../domain/types';

export function decodeAaveTokenLog(log: LogEvent): AaveTokenEvent {
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };

  let parsed: ReturnType<typeof AAVE_TOKEN_INTERFACE.parseLog>;
  try {
    parsed = AAVE_TOKEN_INTERFACE.parseLog({ topics: log.topics, data: log.data });
  } catch (err) {
    throw new DecodeError('parse_failed', err, logRef);
  }

  if (!parsed) {
    throw new DecodeError('unknown_topic', undefined, logRef);
  }

  switch (parsed.fragment.topicHash.toLowerCase()) {
    case AAVE_TOKEN_TOPICS.DelegateChanged:
      return {
        type: 'DelegateChanged',
        payload: {
          delegator: (parsed.args['delegator'] as string).toLowerCase(),
          delegatee: (parsed.args['delegatee'] as string).toLowerCase(),
          delegationType: Number(parsed.args['delegationType'] as bigint),
        },
      };

    default:
      throw new DecodeError('unknown_topic', undefined, logRef);
  }
}
