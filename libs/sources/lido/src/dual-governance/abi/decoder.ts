import type { Interface, LogDescription, Result } from 'ethers';
import type { LogEvent } from '@libs/chain';
import { DecodeError } from '@sources/core';
import {
  DUAL_GOVERNANCE_INTERFACE,
  DUAL_GOVERNANCE_TOPICS,
  TIMELOCK_INTERFACE,
  TIMELOCK_TOPICS,
} from './events';
import { dgStateForOrdinal } from './getters';
import type { DualGovernanceEvent, ExternalCall } from '../domain/types';

const lowercaseAddress = (value: unknown): string => (value as string).toLowerCase();
const toNumber = (value: unknown): number => Number(value as bigint);
const toDecimalString = (value: unknown): string => (value as bigint).toString();

function decodeCalls(raw: unknown): ExternalCall[] {
  return (raw as Result[]).map((call) => ({
    target: lowercaseAddress(call[0]),
    value: toDecimalString(call[1]),
    payload: call[2] as string,
  }));
}

type Builder = (parsed: LogDescription) => DualGovernanceEvent;

interface Dispatch {
  iface: Interface;
  build: Builder;
}

// topic0 → { which interface parses it, how to shape the payload }. Dispatch is by topic0, never by
// event name, because `ProposalSubmitted` is overloaded across the two contracts.
const DISPATCH: Record<string, Dispatch> = {
  [DUAL_GOVERNANCE_TOPICS.DualGovernanceStateChanged]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (parsed) => {
      const context = parsed.args['context'] as Result;
      return {
        type: 'DualGovernanceStateChanged',
        payload: {
          from: dgStateForOrdinal(toNumber(parsed.args['from'])),
          to: dgStateForOrdinal(toNumber(parsed.args['to'])),
          context: {
            state: dgStateForOrdinal(toNumber(context['state'])),
            enteredAt: toNumber(context['enteredAt']),
            vetoSignallingActivatedAt: toNumber(context['vetoSignallingActivatedAt']),
            signallingEscrow: lowercaseAddress(context['signallingEscrow']),
            rageQuitRound: toNumber(context['rageQuitRound']),
            vetoSignallingReactivationTime: toNumber(context['vetoSignallingReactivationTime']),
            normalOrVetoCooldownExitedAt: toNumber(context['normalOrVetoCooldownExitedAt']),
            rageQuitEscrow: lowercaseAddress(context['rageQuitEscrow']),
            configProvider: lowercaseAddress(context['configProvider']),
          },
        },
      };
    },
  },
  [DUAL_GOVERNANCE_TOPICS.NewSignallingEscrowDeployed]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (parsed) => ({
      type: 'NewSignallingEscrowDeployed',
      payload: { escrow: lowercaseAddress(parsed.args['escrow']) },
    }),
  },
  [DUAL_GOVERNANCE_TOPICS.EscrowMasterCopyDeployed]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (parsed) => ({
      type: 'EscrowMasterCopyDeployed',
      payload: { escrowMasterCopy: lowercaseAddress(parsed.args['escrowMasterCopy']) },
    }),
  },
  [DUAL_GOVERNANCE_TOPICS.ConfigProviderSet]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (parsed) => ({
      type: 'ConfigProviderSet',
      payload: { newConfigProvider: lowercaseAddress(parsed.args['newConfigProvider']) },
    }),
  },
  [DUAL_GOVERNANCE_TOPICS.ProposalSubmittedMeta]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (parsed) => ({
      type: 'ProposalSubmittedMeta',
      payload: {
        proposerAccount: lowercaseAddress(parsed.args['proposerAccount']),
        proposalId: toDecimalString(parsed.args['proposalId']),
        metadata: parsed.args['metadata'] as string,
      },
    }),
  },
  [DUAL_GOVERNANCE_TOPICS.ProposalsCancellerSet]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (parsed) => ({
      type: 'ProposalsCancellerSet',
      payload: { proposalsCanceller: lowercaseAddress(parsed.args['proposalsCanceller']) },
    }),
  },
  [DUAL_GOVERNANCE_TOPICS.CancelAllPendingProposalsExecuted]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: () => ({ type: 'CancelAllPendingProposalsExecuted', payload: {} }),
  },
  [DUAL_GOVERNANCE_TOPICS.CancelAllPendingProposalsSkipped]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: () => ({ type: 'CancelAllPendingProposalsSkipped', payload: {} }),
  },
  [DUAL_GOVERNANCE_TOPICS.ProposerRegistered]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (parsed) => ({
      type: 'ProposerRegistered',
      payload: {
        proposerAccount: lowercaseAddress(parsed.args['proposerAccount']),
        executor: lowercaseAddress(parsed.args['executor']),
      },
    }),
  },
  [DUAL_GOVERNANCE_TOPICS.ProposerExecutorSet]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (parsed) => ({
      type: 'ProposerExecutorSet',
      payload: {
        proposerAccount: lowercaseAddress(parsed.args['proposerAccount']),
        executor: lowercaseAddress(parsed.args['executor']),
      },
    }),
  },
  [DUAL_GOVERNANCE_TOPICS.ProposerUnregistered]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (parsed) => ({
      type: 'ProposerUnregistered',
      payload: {
        proposerAccount: lowercaseAddress(parsed.args['proposerAccount']),
        executor: lowercaseAddress(parsed.args['executor']),
      },
    }),
  },
  [TIMELOCK_TOPICS.ProposalSubmitted]: {
    iface: TIMELOCK_INTERFACE,
    build: (parsed) => ({
      type: 'ProposalSubmitted',
      payload: {
        id: toDecimalString(parsed.args['id']),
        executor: lowercaseAddress(parsed.args['executor']),
        calls: decodeCalls(parsed.args['calls']),
      },
    }),
  },
  [TIMELOCK_TOPICS.ProposalScheduled]: {
    iface: TIMELOCK_INTERFACE,
    build: (parsed) => ({
      type: 'ProposalScheduled',
      payload: { id: toDecimalString(parsed.args['id']) },
    }),
  },
  [TIMELOCK_TOPICS.ProposalExecuted]: {
    iface: TIMELOCK_INTERFACE,
    build: (parsed) => ({
      type: 'ProposalExecuted',
      payload: { id: toDecimalString(parsed.args['id']) },
    }),
  },
  [TIMELOCK_TOPICS.ProposalsCancelledTill]: {
    iface: TIMELOCK_INTERFACE,
    build: (parsed) => ({
      type: 'ProposalsCancelledTill',
      payload: { proposalId: toDecimalString(parsed.args['proposalId']) },
    }),
  },
  [TIMELOCK_TOPICS.EmergencyModeActivated]: {
    iface: TIMELOCK_INTERFACE,
    build: () => ({ type: 'EmergencyModeActivated', payload: {} }),
  },
  [TIMELOCK_TOPICS.EmergencyModeDeactivated]: {
    iface: TIMELOCK_INTERFACE,
    build: () => ({ type: 'EmergencyModeDeactivated', payload: {} }),
  },
};

export function decodeDualGovernanceLog(log: LogEvent, _sourceType: string): DualGovernanceEvent {
  const logRef = { txHash: log.txHash, logIndex: log.logIndex, blockHash: log.blockHash };
  const topic0 = log.topics[0]?.toLowerCase();
  const dispatch = topic0 ? DISPATCH[topic0] : undefined;
  if (!dispatch) {
    throw new DecodeError('unknown_topic', undefined, logRef);
  }

  let parsed: LogDescription | null;
  try {
    parsed = dispatch.iface.parseLog({ topics: log.topics, data: log.data });
  } catch (err) {
    throw new DecodeError('parse_failed', err, logRef);
  }
  if (!parsed) {
    throw new DecodeError('parse_failed', undefined, logRef);
  }
  return dispatch.build(parsed);
}
