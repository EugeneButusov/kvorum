import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import { SPLIT_DELEGATION_INTERFACE, SPLIT_DELEGATION_TOPICS } from './events';
import type { SplitDelegationEntry, SplitDelegationEvent } from '../domain/types';

interface DecodedEntry {
  delegate: string;
  ratio: bigint;
}

function toEntries(raw: unknown): SplitDelegationEntry[] {
  return (raw as DecodedEntry[]).map((d) => ({
    delegate: (d.delegate as string).toLowerCase(),
    ratio: d.ratio.toString(),
  }));
}

export function decodeSplitDelegationLog(log: LogEvent): SplitDelegationEvent {
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };

  let parsed: ReturnType<typeof SPLIT_DELEGATION_INTERFACE.parseLog>;
  try {
    parsed = SPLIT_DELEGATION_INTERFACE.parseLog({ topics: log.topics, data: log.data });
  } catch (err) {
    throw new DecodeError('parse_failed', err, logRef);
  }

  if (!parsed) {
    throw new DecodeError('unknown_topic', undefined, logRef);
  }

  switch (parsed.fragment.topicHash.toLowerCase()) {
    case SPLIT_DELEGATION_TOPICS.DelegationUpdated:
      return {
        type: 'DelegationUpdated',
        payload: {
          account: (parsed.args['account'] as string).toLowerCase(),
          context: parsed.args['context'] as string,
          delegation: toEntries(parsed.args['delegation']),
          expirationTimestamp: (parsed.args['expirationTimestamp'] as bigint).toString(),
        },
      };
    case SPLIT_DELEGATION_TOPICS.DelegationCleared:
      return {
        type: 'DelegationCleared',
        payload: {
          account: (parsed.args['account'] as string).toLowerCase(),
          context: parsed.args['context'] as string,
        },
      };
    case SPLIT_DELEGATION_TOPICS.ExpirationUpdated:
      return {
        type: 'ExpirationUpdated',
        payload: {
          account: (parsed.args['account'] as string).toLowerCase(),
          context: parsed.args['context'] as string,
          delegation: toEntries(parsed.args['delegation']),
          expirationTimestamp: (parsed.args['expirationTimestamp'] as bigint).toString(),
        },
      };
    case SPLIT_DELEGATION_TOPICS.OptOutStatusSet:
      return {
        type: 'OptOutStatusSet',
        payload: {
          delegate: (parsed.args['delegate'] as string).toLowerCase(),
          context: parsed.args['context'] as string,
          optout: parsed.args['optout'] as boolean,
        },
      };
    default:
      throw new DecodeError('unknown_topic', undefined, logRef);
  }
}
