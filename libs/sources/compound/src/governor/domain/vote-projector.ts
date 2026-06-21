import type { ArchiveDerivationRow, NewVoteEventsProjectionRow } from '@libs/db';
import type { VoteCastPayload } from './types';

export interface VoteProjectionContext {
  castAt: Date;
  daoId: string;
  proposalId: string;
  voterAddress: string;
}

export interface VoteProjectionResult {
  vote: NewVoteEventsProjectionRow;
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
      vote_id: archiveRow.id,
      dao_id: ctx.daoId,
      proposal_id: ctx.proposalId,
      voter_address: ctx.voterAddress.toLowerCase(),
      voting_chain_id: archiveRow.chain_id,
      voting_power: payload.votingPowerReported,
      cast_at: ctx.castAt,
      block_number: archiveRow.block_number,
      log_index: archiveRow.log_index,
      primary_choice: payload.primaryChoice,
      superseded: 0,
      superseded_at: null,
      superseded_by_vote_id: null,
    },
    choice: {
      choice_index: payload.primaryChoice,
      weight: '1.0',
    },
  };
}
