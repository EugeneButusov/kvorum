import {
  ZERO_DELEGATE_ADDRESS,
  type ArchiveDerivationRow,
  type NewDelegationFlowProjectionRow,
} from '@libs/db';
import type { DelegateChangedPayload, DelegateVotesChangedPayload } from './types';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function projectDelegateChanged(
  payload: DelegateChangedPayload,
  archiveRow: ArchiveDerivationRow,
  ctx: {
    daoId: string;
    delegatorAddress: string;
  },
): NewDelegationFlowProjectionRow {
  return {
    delegation_id: archiveRow.id,
    dao_id: ctx.daoId,
    delegator_address: ctx.delegatorAddress.toLowerCase(),
    delegate_address:
      payload.toDelegate === ZERO_ADDRESS
        ? ZERO_DELEGATE_ADDRESS
        : payload.toDelegate.toLowerCase(),
    voting_power: '0',
    block_number: archiveRow.block_number,
    log_index: archiveRow.log_index,
    event_type: 'delegate_changed',
    created_at: archiveRow.received_at,
  };
}

export function projectDelegateVotesChanged(
  payload: DelegateVotesChangedPayload,
  archiveRow: ArchiveDerivationRow,
  ctx: { daoId: string; delegateAddress: string },
): NewDelegationFlowProjectionRow {
  return {
    delegation_id: archiveRow.id,
    dao_id: ctx.daoId,
    delegator_address: ctx.delegateAddress.toLowerCase(),
    delegate_address: ctx.delegateAddress.toLowerCase(),
    voting_power: payload.newVotes,
    block_number: archiveRow.block_number,
    log_index: archiveRow.log_index,
    event_type: 'votes_changed',
    created_at: archiveRow.received_at,
  };
}
