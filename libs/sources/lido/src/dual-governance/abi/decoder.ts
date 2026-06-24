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

const lc = (v: unknown): string => (v as string).toLowerCase();
const num = (v: unknown): number => Number(v as bigint);
const dec = (v: unknown): string => (v as bigint).toString();

function decodeCalls(raw: unknown): ExternalCall[] {
  return (raw as Result[]).map((c) => ({
    target: lc(c[0]),
    value: dec(c[1]),
    payload: c[2] as string,
  }));
}

type Builder = (parsed: LogDescription) => DualGovernanceEvent;

interface Dispatch {
  iface: Interface;
  build: Builder;
}

const T = DUAL_GOVERNANCE_TOPICS;
const L = TIMELOCK_TOPICS;

// topic0 → { which interface parses it, how to shape the payload }. Dispatch is by topic0, never by
// event name, because `ProposalSubmitted` is overloaded across the two contracts.
const DISPATCH: Record<string, Dispatch> = {
  [T.DualGovernanceStateChanged]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (p) => {
      const c = p.args['context'] as Result;
      return {
        type: 'DualGovernanceStateChanged',
        payload: {
          from: dgStateForOrdinal(num(p.args['from'])),
          to: dgStateForOrdinal(num(p.args['to'])),
          context: {
            state: dgStateForOrdinal(num(c['state'])),
            enteredAt: num(c['enteredAt']),
            vetoSignallingActivatedAt: num(c['vetoSignallingActivatedAt']),
            signallingEscrow: lc(c['signallingEscrow']),
            rageQuitRound: num(c['rageQuitRound']),
            vetoSignallingReactivationTime: num(c['vetoSignallingReactivationTime']),
            normalOrVetoCooldownExitedAt: num(c['normalOrVetoCooldownExitedAt']),
            rageQuitEscrow: lc(c['rageQuitEscrow']),
            configProvider: lc(c['configProvider']),
          },
        },
      };
    },
  },
  [T.NewSignallingEscrowDeployed]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (p) => ({
      type: 'NewSignallingEscrowDeployed',
      payload: { escrow: lc(p.args['escrow']) },
    }),
  },
  [T.EscrowMasterCopyDeployed]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (p) => ({
      type: 'EscrowMasterCopyDeployed',
      payload: { escrowMasterCopy: lc(p.args['escrowMasterCopy']) },
    }),
  },
  [T.ConfigProviderSet]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (p) => ({
      type: 'ConfigProviderSet',
      payload: { newConfigProvider: lc(p.args['newConfigProvider']) },
    }),
  },
  [T.ProposalSubmittedMeta]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (p) => ({
      type: 'ProposalSubmittedMeta',
      payload: {
        proposerAccount: lc(p.args['proposerAccount']),
        proposalId: dec(p.args['proposalId']),
        metadata: p.args['metadata'] as string,
      },
    }),
  },
  [T.ProposalsCancellerSet]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (p) => ({
      type: 'ProposalsCancellerSet',
      payload: { proposalsCanceller: lc(p.args['proposalsCanceller']) },
    }),
  },
  [T.CancelAllPendingProposalsExecuted]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: () => ({ type: 'CancelAllPendingProposalsExecuted', payload: {} }),
  },
  [T.CancelAllPendingProposalsSkipped]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: () => ({ type: 'CancelAllPendingProposalsSkipped', payload: {} }),
  },
  [T.ProposerRegistered]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (p) => ({
      type: 'ProposerRegistered',
      payload: { proposerAccount: lc(p.args['proposerAccount']), executor: lc(p.args['executor']) },
    }),
  },
  [T.ProposerExecutorSet]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (p) => ({
      type: 'ProposerExecutorSet',
      payload: { proposerAccount: lc(p.args['proposerAccount']), executor: lc(p.args['executor']) },
    }),
  },
  [T.ProposerUnregistered]: {
    iface: DUAL_GOVERNANCE_INTERFACE,
    build: (p) => ({
      type: 'ProposerUnregistered',
      payload: { proposerAccount: lc(p.args['proposerAccount']), executor: lc(p.args['executor']) },
    }),
  },
  [L.ProposalSubmitted]: {
    iface: TIMELOCK_INTERFACE,
    build: (p) => ({
      type: 'ProposalSubmitted',
      payload: {
        id: dec(p.args['id']),
        executor: lc(p.args['executor']),
        calls: decodeCalls(p.args['calls']),
      },
    }),
  },
  [L.ProposalScheduled]: {
    iface: TIMELOCK_INTERFACE,
    build: (p) => ({ type: 'ProposalScheduled', payload: { id: dec(p.args['id']) } }),
  },
  [L.ProposalExecuted]: {
    iface: TIMELOCK_INTERFACE,
    build: (p) => ({ type: 'ProposalExecuted', payload: { id: dec(p.args['id']) } }),
  },
  [L.ProposalsCancelledTill]: {
    iface: TIMELOCK_INTERFACE,
    build: (p) => ({
      type: 'ProposalsCancelledTill',
      payload: { proposalId: dec(p.args['proposalId']) },
    }),
  },
  [L.EmergencyModeActivated]: {
    iface: TIMELOCK_INTERFACE,
    build: () => ({ type: 'EmergencyModeActivated', payload: {} }),
  },
  [L.EmergencyModeDeactivated]: {
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
