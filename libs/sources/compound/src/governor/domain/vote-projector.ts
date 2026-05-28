import type { ArchiveDerivationRow } from '@libs/db';
import type { VoteCastPayload } from './types';

export interface VoteProjectionContext {
  castAt: Date;
  voterActorId: string;
  proposalId: string;
}

export interface VoteProjectionResult {
  vote: {
    proposal_id: string;
    voter_actor_id: string;
    voting_power_reported: string;
    cast_at: Date;
    block_number: string;
    tx_index: number;
    tx_hash: string;
    log_index: number;
    primary_choice: number;
    reason: string | null;
  };
  choice: {
    choice_index: number;
    weight: string;
  };
}

export function projectVoteCast(
  payload: VoteCastPayload,
  archiveRow: ArchiveDerivationRow,
  ctx: VoteProjectionContext,
): VoteProjectionResult {
  return {
    vote: {
      proposal_id: ctx.proposalId,
      voter_actor_id: ctx.voterActorId,
      voting_power_reported: payload.votingPowerReported,
      cast_at: ctx.castAt,
      block_number: archiveRow.block_number,
      tx_index: 0,
      tx_hash: archiveRow.tx_hash,
      log_index: archiveRow.log_index,
      primary_choice: payload.primaryChoice,
      reason: payload.compound.reason,
    },
    choice: {
      choice_index: payload.primaryChoice,
      weight: '1.0',
    },
  };
}
