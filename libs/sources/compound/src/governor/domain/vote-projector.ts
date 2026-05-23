import type { InsertEventVoteRow } from '@libs/db';
import type { ArchiveDerivationRow } from '@libs/db';
import type { VoteCastPayload } from './types';

export interface VoteProjectionContext {
  castAt: Date;
  voterActorId: string;
  proposalId: string;
}

export interface VoteProjectionResult {
  vote: InsertEventVoteRow;
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
