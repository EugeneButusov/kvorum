import type { VoteReadRow } from '@libs/db';
import { ActorVoteListItemDto } from './actor-vote.dto';
import { isoSeconds } from '../http/iso';

export function toActorVoteListItemDto(row: VoteReadRow): ActorVoteListItemDto {
  return Object.assign(new ActorVoteListItemDto(), {
    vote_id: row.id,
    voting_chain_id: row.voting_chain_id,
    proposal: {
      proposal_id: row.proposal_source_id,
      source_type: row.proposal_source_type,
      dao_slug: row.dao_slug,
      title: row.proposal_title,
      state: row.proposal_state,
      created_at: isoSeconds(row.proposal_created_at),
      voting_ends_at:
        row.proposal_voting_ends_at == null ? null : isoSeconds(row.proposal_voting_ends_at),
      _meta: {
        links: {
          proposal: `/v1/daos/${row.dao_slug}/proposals/${row.proposal_source_type}/${row.proposal_source_id}`,
        },
      },
    },
    primary_choice: row.primary_choice,
    voting_power_reported: row.voting_power_reported,
    cast_at: isoSeconds(row.cast_at),
    _meta: { confirmed: true },
  });
}
