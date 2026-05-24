import type { VoteChoiceReadRow, VoteReadRow } from '@libs/db';
import { isoSeconds } from '../http/iso';
import { VoteDetailDto, VoteListItemDto } from './vote.dto';

function toEmbeddedVoter(row: VoteReadRow) {
  return {
    address: row.voter_address.toLowerCase(),
    display_name: row.voter_display_name,
    _meta: {
      links: {
        actor: `/v1/actors/${row.voter_address.toLowerCase()}`,
      },
    },
  };
}

export function toVoteListItemDto(row: VoteReadRow): VoteListItemDto {
  return Object.assign(new VoteListItemDto(), {
    vote_id: row.id,
    voter: toEmbeddedVoter(row),
    voting_power_reported: row.voting_power_reported,
    voting_power_verified: row.voting_power_verified,
    primary_choice: row.primary_choice,
    cast_at: isoSeconds(row.cast_at),
    reason: row.reason,
    _meta: { confirmed: true },
  });
}

export function toVoteDetailDto(row: VoteReadRow, choices: VoteChoiceReadRow[]): VoteDetailDto {
  return Object.assign(new VoteDetailDto(), {
    ...toVoteListItemDto(row),
    choices: choices.map((choice) => ({
      choice_index: choice.choice_index,
      weight: choice.weight,
    })),
  });
}
