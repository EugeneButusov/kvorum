import type { ProposalReadRepository } from '@libs/db';
import { ActorProposalListItemDto } from './actor-proposal.dto';
import { isoSeconds } from '../http/iso';

type ProposalListRow =
  Awaited<ReturnType<ProposalReadRepository['findOne']>> extends infer R ? NonNullable<R> : never;

export function toActorProposalListItemDto(row: ProposalListRow): ActorProposalListItemDto {
  return Object.assign(new ActorProposalListItemDto(), {
    proposal_id: row.source_id,
    source_type: row.source_type,
    dao_slug: row.dao_slug,
    title: row.title,
    state: row.state,
    voting_starts_at: row.voting_starts_at == null ? null : isoSeconds(row.voting_starts_at),
    voting_ends_at: row.voting_ends_at == null ? null : isoSeconds(row.voting_ends_at),
    created_at: isoSeconds(row.created_at),
    _meta: { confirmed: true },
  });
}
