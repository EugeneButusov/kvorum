import type { Kysely, SelectQueryBuilder } from 'kysely';
import type { PgDatabase, ProposalAction, ProposalChoice } from './schema/pg';

// ADR-040: keep DB schema-aware read-query construction in libs/db.
export class ProposalReadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  listBaseQuery(): SelectQueryBuilder<
    PgDatabase,
    'proposal' | 'dao' | 'actor',
    {
      id: string;
      dao_slug: string;
      source_type: string;
      source_id: string;
      title: string | null;
      description: string;
      state: string;
      binding: boolean;
      voting_starts_at: Date | null;
      voting_ends_at: Date | null;
      voting_power_block: string;
      state_updated_at: Date;
      created_at: Date;
      proposer_address: string;
      proposer_display_name: string | null;
    }
  > {
    return this.db
      .selectFrom('proposal')
      .innerJoin('dao', 'dao.id', 'proposal.dao_id')
      .innerJoin('actor', 'actor.id', 'proposal.proposer_actor_id')
      .select([
        'proposal.id',
        'dao.slug as dao_slug',
        'proposal.source_type',
        'proposal.source_id',
        'proposal.title',
        'proposal.description',
        'proposal.state',
        'proposal.binding',
        'proposal.voting_starts_at',
        'proposal.voting_ends_at',
        'proposal.voting_power_block',
        'proposal.state_updated_at',
        'proposal.created_at',
        'actor.primary_address as proposer_address',
        'actor.display_name as proposer_display_name',
      ]);
  }

  async findOne(daoSlug: string, sourceType: string, sourceId: string) {
    return this.listBaseQuery()
      .where('dao.slug', '=', daoSlug)
      .where('proposal.source_type', '=', sourceType)
      .where('proposal.source_id', '=', sourceId)
      .executeTakeFirst();
  }

  async findActions(proposalId: string): Promise<ProposalAction[]> {
    return this.db
      .selectFrom('proposal_action')
      .selectAll()
      .where('proposal_id', '=', proposalId)
      .orderBy('action_index', 'asc')
      .execute();
  }

  async findChoices(proposalId: string): Promise<ProposalChoice[]> {
    return this.db
      .selectFrom('proposal_choice')
      .selectAll()
      .where('proposal_id', '=', proposalId)
      .orderBy('choice_index', 'asc')
      .execute();
  }
}
