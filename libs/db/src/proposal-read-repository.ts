import type { Kysely, SelectQueryBuilder } from 'kysely';
import type { Dao, PgDatabase, Proposal, ProposalAction, ProposalChoice } from './schema/pg';

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
      description_hash: string;
      state: string;
      binding: boolean;
      voting_starts_at: Date | null;
      voting_ends_at: Date | null;
      voting_starts_block: string | null;
      voting_ends_block: string | null;
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
        'proposal.description_hash',
        'proposal.state',
        'proposal.binding',
        'proposal.voting_starts_at',
        'proposal.voting_ends_at',
        'proposal.voting_starts_block',
        'proposal.voting_ends_block',
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

  async findOneWithDao(
    daoSlug: string,
    sourceType: string,
    sourceId: string,
  ): Promise<{ dao: Dao; proposal: Proposal } | undefined> {
    const row = await this.db
      .selectFrom('proposal')
      .innerJoin('dao', 'dao.id', 'proposal.dao_id')
      .select([
        'dao.id as dao_id',
        'dao.slug as dao_slug',
        'dao.name as dao_name',
        'dao.primary_token_address as dao_primary_token_address',
        'dao.primary_chain_id as dao_primary_chain_id',
        'dao.description as dao_description',
        'dao.website_url as dao_website_url',
        'dao.forum_url as dao_forum_url',
        'dao.created_at as dao_created_at',
        'dao.updated_at as dao_updated_at',
        'proposal.id as proposal_id',
        'proposal.dao_id as proposal_dao_id',
        'proposal.source_type as proposal_source_type',
        'proposal.source_id as proposal_source_id',
        'proposal.proposer_actor_id as proposal_proposer_actor_id',
        'proposal.title as proposal_title',
        'proposal.description as proposal_description',
        'proposal.description_hash as proposal_description_hash',
        'proposal.binding as proposal_binding',
        'proposal.voting_starts_at as proposal_voting_starts_at',
        'proposal.voting_ends_at as proposal_voting_ends_at',
        'proposal.voting_starts_block as proposal_voting_starts_block',
        'proposal.voting_ends_block as proposal_voting_ends_block',
        'proposal.state as proposal_state',
        'proposal.state_updated_at as proposal_state_updated_at',
        'proposal.created_at as proposal_created_at',
        'proposal.updated_at as proposal_updated_at',
        'proposal.forum_link_scanned_at as proposal_forum_link_scanned_at',
      ])
      .where('dao.slug', '=', daoSlug)
      .where('proposal.source_type', '=', sourceType)
      .where('proposal.source_id', '=', sourceId)
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    const dao: Dao = {
      id: row.dao_id,
      slug: row.dao_slug,
      name: row.dao_name,
      primary_token_address: row.dao_primary_token_address,
      primary_chain_id: row.dao_primary_chain_id,
      description: row.dao_description,
      website_url: row.dao_website_url,
      forum_url: row.dao_forum_url,
      created_at: row.dao_created_at,
      updated_at: row.dao_updated_at,
    };

    const proposal: Proposal = {
      id: row.proposal_id,
      dao_id: row.proposal_dao_id,
      source_type: row.proposal_source_type,
      source_id: row.proposal_source_id,
      proposer_actor_id: row.proposal_proposer_actor_id,
      title: row.proposal_title,
      description: row.proposal_description,
      description_hash: row.proposal_description_hash,
      binding: row.proposal_binding,
      voting_starts_at: row.proposal_voting_starts_at,
      voting_ends_at: row.proposal_voting_ends_at,
      voting_starts_block: row.proposal_voting_starts_block,
      voting_ends_block: row.proposal_voting_ends_block,
      state: row.proposal_state,
      state_updated_at: row.proposal_state_updated_at,
      created_at: row.proposal_created_at,
      updated_at: row.proposal_updated_at,
      forum_link_scanned_at: row.proposal_forum_link_scanned_at,
    };

    return { dao, proposal };
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

  async resolveOriginChainId(proposalId: string, sourceType: string): Promise<string> {
    const row = await this.db
      .selectFrom('proposal')
      .innerJoin('dao', 'dao.id', 'proposal.dao_id')
      .leftJoin('dao_source', (join) =>
        join
          .onRef('dao_source.dao_id', '=', 'proposal.dao_id')
          .on('dao_source.source_type', '=', sourceType),
      )
      .select(['dao.primary_chain_id', 'dao_source.chain_id as source_chain_id'])
      .where('proposal.id', '=', proposalId)
      .executeTakeFirst();

    return row?.source_chain_id ?? row?.primary_chain_id ?? '0x1';
  }
}
