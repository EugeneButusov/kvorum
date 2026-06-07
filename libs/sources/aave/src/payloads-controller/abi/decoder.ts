import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { interfaceForAavePayloadsController } from './events';
import type { AavePayloadsControllerEvent } from '../domain/types';

export function decodeAavePayloadsControllerLog(
  log: LogEvent,
  _sourceType: string,
): AavePayloadsControllerEvent {
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };
  const { iface, topics } = interfaceForAavePayloadsController();

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
    case topics.PayloadCreated:
      return {
        type: 'PayloadCreated',
        payload: {
          payloadId: (parsed.args['payloadId'] as bigint).toString(),
          creator: (parsed.args['creator'] as string).toLowerCase(),
          maximumAccessLevelRequired: Number(parsed.args['maximumAccessLevelRequired']),
          actions: (
            parsed.args['actions'] as Array<{
              target: string;
              withDelegateCall: boolean;
              accessLevel: bigint;
              value: bigint;
              signature: string;
              callData: string;
            }>
          ).map((action) => ({
            target: action.target.toLowerCase(),
            withDelegateCall: action.withDelegateCall,
            accessLevel: Number(action.accessLevel),
            value: action.value.toString(),
            signature: action.signature,
            callData: action.callData,
          })),
        },
      };
    case topics.PayloadQueued:
      return {
        type: 'PayloadQueued',
        payload: { payloadId: (parsed.args['payloadId'] as bigint).toString() },
      };
    case topics.PayloadExecuted:
      return {
        type: 'PayloadExecuted',
        payload: { payloadId: (parsed.args['payloadId'] as bigint).toString() },
      };
    case topics.PayloadCancelled:
      return {
        type: 'PayloadCancelled',
        payload: { payloadId: (parsed.args['payloadId'] as bigint).toString() },
      };
    default:
      throw new DecodeError('unknown_topic', undefined, logRef);
  }
}
