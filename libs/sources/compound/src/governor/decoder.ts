import type { LogEvent } from '@libs/chain';
import { COMPOUND_EVENT_TOPICS, COMPOUND_GOVERNOR_INTERFACE } from './events.js';
import type { CompoundGovernorEvent } from './types.js';
import { DecodeError } from './types.js';

/** Decodes a normalised LogEvent from EventPoller into a typed CompoundGovernorEvent.
 *  Throws DecodeError on unknown topic0 or malformed args. */
export function decodeCompoundLog(log: LogEvent): CompoundGovernorEvent {
  const topic0 = log.topics[0]?.toLowerCase();
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };

  const knownTopics: string[] = Object.values(COMPOUND_EVENT_TOPICS);
  if (!topic0 || !knownTopics.includes(topic0)) {
    throw new DecodeError('unknown_topic', undefined, logRef);
  }

  let parsed: ReturnType<typeof COMPOUND_GOVERNOR_INTERFACE.parseLog>;
  try {
    parsed = COMPOUND_GOVERNOR_INTERFACE.parseLog({ topics: log.topics, data: log.data });
  } catch (err) {
    throw new DecodeError('parse_failed', err, logRef);
  }

  if (!parsed) {
    throw new DecodeError('parse_failed', new Error('parseLog returned null'), logRef);
  }

  switch (topic0) {
    case COMPOUND_EVENT_TOPICS.ProposalCreated: {
      const args = parsed.args;
      // Use positional index for 'values' (index 3) to avoid conflict with Array.prototype.values
      const abiValues = args[3] as unknown as bigint[];
      return {
        type: 'ProposalCreated',
        payload: {
          proposalId: (args['id'] as bigint).toString(),
          proposer: (args['proposer'] as string).toLowerCase(),
          targets: (args['targets'] as unknown as string[]).map((a) => a.toLowerCase()),
          values: Array.isArray(abiValues) ? abiValues.map((v) => v.toString()) : [],
          signatures: args['signatures'] as string[],
          calldatas: args['calldatas'] as string[],
          startBlock: (args['startBlock'] as bigint).toString(),
          endBlock: (args['endBlock'] as bigint).toString(),
          description: args['description'] as string,
        },
      };
    }

    case COMPOUND_EVENT_TOPICS.ProposalQueued: {
      const args = parsed.args;
      return {
        type: 'ProposalQueued',
        payload: {
          proposalId: (args['id'] as bigint).toString(),
          eta: (args['eta'] as bigint).toString(),
        },
      };
    }

    case COMPOUND_EVENT_TOPICS.ProposalExecuted: {
      const args = parsed.args;
      return {
        type: 'ProposalExecuted',
        payload: {
          proposalId: (args['id'] as bigint).toString(),
        },
      };
    }

    case COMPOUND_EVENT_TOPICS.ProposalCanceled: {
      const args = parsed.args;
      return {
        type: 'ProposalCanceled',
        payload: {
          proposalId: (args['id'] as bigint).toString(),
        },
      };
    }

    default:
      throw new DecodeError('unknown_topic', undefined, logRef);
  }
}
