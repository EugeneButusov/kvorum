import type { ArchiveDerivationRow } from '@libs/db';
import type { DelegateChangedPayload, DelegateVotesChangedPayload } from './types';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type ProjectedDelegationRow = {
  dao_id: string;
  delegator_actor_id: string;
  delegate_actor_id: string | null;
  voting_power: string;
  block_number: string;
  tx_index: number;
  log_index: number;
  tx_hash: string;
  event_type: 'delegate_changed' | 'votes_changed';
};

export function projectDelegateChanged(
  _payload: DelegateChangedPayload,
  archiveRow: ArchiveDerivationRow,
  ctx: {
    daoId: string;
    delegatorActorId: string;
    delegateActorId: string | null;
  },
): ProjectedDelegationRow {
  return {
    dao_id: ctx.daoId,
    delegator_actor_id: ctx.delegatorActorId,
    delegate_actor_id: ctx.delegateActorId,
    voting_power: '0',
    block_number: archiveRow.block_number,
    tx_index: 0,
    log_index: archiveRow.log_index,
    tx_hash: archiveRow.tx_hash,
    event_type: 'delegate_changed',
  };
}

export function projectDelegateVotesChanged(
  payload: DelegateVotesChangedPayload,
  archiveRow: ArchiveDerivationRow,
  ctx: { daoId: string; delegateActorId: string },
): ProjectedDelegationRow {
  return {
    dao_id: ctx.daoId,
    delegator_actor_id: ctx.delegateActorId,
    delegate_actor_id: ctx.delegateActorId,
    voting_power: payload.newVotes,
    block_number: archiveRow.block_number,
    tx_index: 0,
    log_index: archiveRow.log_index,
    tx_hash: archiveRow.tx_hash,
    event_type: 'votes_changed',
  };
}
