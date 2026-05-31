import type { Interface } from 'ethers';
import type { LogEvent } from '@libs/chain';
import { chainMetrics } from '@libs/chain';
import { interfaceForSource, type CompoundGovernorVariant } from './events';
import { DecodeError } from '../../shared';
import type { CompoundGovernorEvent } from '../domain/types';

export function decodeCompoundLog(log: LogEvent, sourceType: string): CompoundGovernorEvent {
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };

  let iface: ReturnType<typeof interfaceForSource>['iface'];
  let variant: CompoundGovernorVariant;
  try {
    ({ iface, variant } = interfaceForSource(sourceType));
  } catch (err) {
    throw new DecodeError('wrong_variant', err, logRef);
  }

  let parsed: ReturnType<typeof iface.parseLog>;
  try {
    parsed = iface.parseLog({ topics: log.topics, data: log.data });
  } catch (err) {
    throw new DecodeError('parse_failed', err, logRef);
  }

  if (!parsed) {
    throw new DecodeError('unknown_topic', undefined, logRef);
  }

  switch (parsed.name) {
    case 'ProposalCreated': {
      const args = parsed.args;
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

    case 'ProposalQueued': {
      const args = parsed.args;
      return {
        type: 'ProposalQueued',
        payload: {
          proposalId: (args['id'] as bigint).toString(),
          eta: (args['eta'] as bigint).toString(),
        },
      };
    }

    case 'ProposalExecuted': {
      const args = parsed.args;
      return {
        type: 'ProposalExecuted',
        payload: {
          proposalId: (args['id'] as bigint).toString(),
        },
      };
    }

    case 'ProposalCanceled': {
      const args = parsed.args;
      return {
        type: 'ProposalCanceled',
        payload: {
          proposalId: (args['id'] as bigint).toString(),
        },
      };
    }

    case 'VoteCast':
      return decodeVoteCast(parsed, variant);

    default:
      throw new DecodeError('unknown_topic', undefined, logRef);
  }
}

function decodeVoteCast(
  parsed: ReturnType<Interface['parseLog']>,
  variant: CompoundGovernorVariant,
): CompoundGovernorEvent {
  const args = parsed!.args;
  const voter = (args['voter'] as string).toLowerCase();
  const proposalId = (args['proposalId'] as bigint).toString();

  if (variant === 'compound_governor_alpha') {
    const support = args['support'] as boolean;
    const votingPower = (args['votes'] as bigint).toString();
    return {
      type: 'VoteCast',
      payload: {
        voter,
        proposalId,
        primaryChoice: support ? 1 : 0,
        votingPowerReported: votingPower,
        compound: {
          supportRaw: support,
          reason: null,
        },
      },
    };
  }

  const support = Number(args['support']);
  const votingPowerArg = (args['votes'] ?? args['weight']) as bigint;
  if (support < 0 || support > 2) {
    chainMetrics.archiveDecodeWarnings.add(1, { source: variant, reason: 'unexpected_support' });
  }
  return {
    type: 'VoteCast',
    payload: {
      voter,
      proposalId,
      primaryChoice: support,
      votingPowerReported: votingPowerArg.toString(),
      compound: {
        supportRaw: support,
        reason: ((args['reason'] as string | undefined) ?? null) as string | null,
      },
    },
  };
}
