import {
  ZERO_DELEGATE_ADDRESS,
  type ArchiveDerivationRow,
  type NewDelegationFlowProjectionRow,
} from '@libs/db';
import type { DelegateChangedPayload } from './types';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function projectSweepVotesChanged(
  delegateAddress: string,
  votingPower: bigint,
  ctx: { daoId: string; delegationId: string; blockNumber: string; createdAt: Date },
): NewDelegationFlowProjectionRow {
  return {
    delegation_id: ctx.delegationId,
    dao_id: ctx.daoId,
    delegator_address: delegateAddress.toLowerCase(),
    delegate_address: delegateAddress.toLowerCase(),
    voting_power: votingPower.toString(),
    block_number: ctx.blockNumber,
    log_index: 0,
    event_type: 'votes_changed',
    created_at: ctx.createdAt,
  };
}

// Projects a VOTING-power DelegateChanged into a single delegation-relationship row,
// 1:1 with Compound's `delegate_changed` rows. voting_power is '0' — V3 emits no
// power-delta event, so a per-delegation power amount is not sourceable (ADR-0070).
// AaveTokenV3 normalizes self-delegation/undelegation to address(0) before emitting,
// so delegatee == address(0) is the canonical "no delegation" state → null delegate.
export function projectVotingDelegateChanged(
  payload: DelegateChangedPayload,
  archiveRow: ArchiveDerivationRow,
  ctx: { daoId: string },
): NewDelegationFlowProjectionRow {
  return {
    delegation_id: archiveRow.id,
    dao_id: ctx.daoId,
    delegator_address: payload.delegator.toLowerCase(),
    delegate_address:
      payload.delegatee === ZERO_ADDRESS ? ZERO_DELEGATE_ADDRESS : payload.delegatee.toLowerCase(),
    voting_power: '0',
    block_number: archiveRow.block_number,
    log_index: archiveRow.log_index,
    event_type: 'delegate_changed',
    created_at: archiveRow.received_at,
  };
}
