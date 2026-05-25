import type { Kysely, SelectQueryBuilder } from 'kysely';
import type { PgDatabase } from './schema/pg';

export type VoteReadRow = {
  id: string;
  voting_power_reported: string;
  voting_power_verified: boolean;
  primary_choice: number | null;
  cast_at: Date;
  reason: string | null;
  proposal_id: string;
  voter_actor_id: string;
  voter_address: string;
  voter_display_name: string | null;
  proposal_source_type: string;
  proposal_source_id: string;
  proposal_title: string | null;
  proposal_state: string;
  proposal_created_at: Date;
  proposal_voting_ends_at: Date | null;
  dao_slug: string;
};

export type VoteChoiceReadRow = {
  choice_index: number;
  weight: string;
};

export class VoteReadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  listBaseQuery(): SelectQueryBuilder<
    PgDatabase,
    'vote' | 'actor' | 'proposal' | 'dao',
    VoteReadRow
  > {
    return this.db
      .selectFrom('vote')
      .innerJoin('actor', 'actor.id', 'vote.voter_actor_id')
      .innerJoin('proposal', 'proposal.id', 'vote.proposal_id')
      .innerJoin('dao', 'dao.id', 'proposal.dao_id')
      .select([
        'vote.id',
        'vote.voting_power_reported',
        'vote.voting_power_verified',
        'vote.primary_choice',
        'vote.cast_at',
        'vote.reason',
        'vote.proposal_id',
        'actor.id as voter_actor_id',
        'actor.primary_address as voter_address',
        'actor.display_name as voter_display_name',
        'proposal.source_type as proposal_source_type',
        'proposal.source_id as proposal_source_id',
        'proposal.title as proposal_title',
        'proposal.state as proposal_state',
        'proposal.created_at as proposal_created_at',
        'proposal.voting_ends_at as proposal_voting_ends_at',
        'dao.slug as dao_slug',
      ])
      .where('vote.superseded_by_vote_id', 'is', null);
  }

  async findOneByVoter(proposalId: string, voterActorId: string): Promise<VoteReadRow | undefined> {
    return this.listBaseQuery()
      .where('vote.proposal_id', '=', proposalId)
      .where('vote.voter_actor_id', '=', voterActorId)
      .executeTakeFirst();
  }

  async findChoicesForVote(voteId: string): Promise<VoteChoiceReadRow[]> {
    return this.db
      .selectFrom('vote_choice')
      .select(['choice_index', 'weight'])
      .where('vote_id', '=', voteId)
      .orderBy('choice_index', 'asc')
      .execute();
  }
}
