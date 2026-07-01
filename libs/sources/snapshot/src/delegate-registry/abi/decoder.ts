import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { DELEGATE_REGISTRY_INTERFACE, DELEGATE_REGISTRY_TOPICS } from './events';
import type { DelegateRegistryEvent } from '../domain/types';

export function decodeDelegateRegistryLog(log: LogEvent): DelegateRegistryEvent {
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };

  let parsed: ReturnType<typeof DELEGATE_REGISTRY_INTERFACE.parseLog>;
  try {
    parsed = DELEGATE_REGISTRY_INTERFACE.parseLog({ topics: log.topics, data: log.data });
  } catch (err) {
    throw new DecodeError('parse_failed', err, logRef);
  }

  if (!parsed) {
    throw new DecodeError('unknown_topic', undefined, logRef);
  }

  const payload = {
    delegator: (parsed.args['delegator'] as string).toLowerCase(),
    id: (parsed.args['id'] as string).toLowerCase(),
    delegate: (parsed.args['delegate'] as string).toLowerCase(),
  };

  switch (parsed.fragment.topicHash.toLowerCase()) {
    case DELEGATE_REGISTRY_TOPICS.SetDelegate:
      return { type: 'SetDelegate', payload };
    case DELEGATE_REGISTRY_TOPICS.ClearDelegate:
      return { type: 'ClearDelegate', payload };
    default:
      throw new DecodeError('unknown_topic', undefined, logRef);
  }
}
