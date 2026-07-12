import { sql, type Kysely } from 'kysely';
import { chTimestampToDate } from './ch-timestamp';
import { chDb, pgDb } from './client';
import type { ClickHouseDatabase } from './schema/clickhouse';
import type { PgDatabase } from './schema/pg';

export type VoteReadRow = {
  id: string;
  voting_chain_id: string;
  voting_power_reported: string;
  voting_power_verified: boolean;
  primary_choice: number;
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

export type ProposalTallyRow = {
  primary_choice: number;
  /** Summed voting power for the choice, UInt256 base units (exact string). */
  voting_power: string;
  voter_count: number;
};

type VoteEventsProjectionTable = {
  vote_id: string;
  proposal_id: string;
  voter_address: string;
  primary_choice: number;
  voting_power: string;
  voting_chain_id: string;
  cast_at: Date;
  superseded: number;
};

export class VoteReadRepository {
  private readonly pg: Kysely<PgDatabase>;
  private readonly ch: Kysely<ClickHouseDatabase>;

  constructor(pg: Kysely<PgDatabase> = pgDb, ch: Kysely<ClickHouseDatabase> = chDb) {
    this.pg = pg;
    this.ch = ch;
  }

  async listForProposal(args: {
    proposalId: string;
    voterActorId?: string;
    primaryChoices?: number[];
  }): Promise<VoteReadRow[]> {
    const proposal = await this.fetchProposal(args.proposalId);
    if (proposal === undefined) return [];

    let qb = this.ch
      .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('v'))
      .select([
        'v.vote_id as id',
        'v.voting_power as voting_power_reported',
        'v.primary_choice',
        'v.voting_chain_id',
        'v.cast_at',
        'v.proposal_id',
        'v.voter_address',
      ])
      .where('v.proposal_id', '=', args.proposalId)
      .where('v.superseded', '=', 0);

    if ((args.primaryChoices?.length ?? 0) > 0) {
      qb = qb.where('v.primary_choice', 'in', args.primaryChoices!);
    }

    const rows = await qb.orderBy('v.cast_at', 'desc').orderBy('v.vote_id', 'desc').execute();
    const normalizedRows = rows.map((row) => ({
      ...row,
      voter_address: row.voter_address.toLowerCase(),
    }));

    const actorByAddress = await this.fetchActorsByAddress(
      normalizedRows.map((row) => row.voter_address),
    );

    return normalizedRows.flatMap((row) => {
      const actor = actorByAddress.get(row.voter_address);
      if (args.voterActorId !== undefined && actor?.id !== args.voterActorId) return [];
      return [
        {
          id: row.id,
          voting_chain_id: row.voting_chain_id,
          voting_power_reported: row.voting_power_reported,
          voting_power_verified: false,
          primary_choice: row.primary_choice,
          cast_at: chTimestampToDate(row.cast_at),
          reason: null,
          proposal_id: row.proposal_id,
          voter_actor_id: actor?.id ?? '',
          voter_address: row.voter_address,
          voter_display_name: actor?.display_name ?? null,
          proposal_source_type: proposal.source_type,
          proposal_source_id: proposal.source_id,
          proposal_title: proposal.title,
          proposal_state: proposal.state,
          proposal_created_at: proposal.created_at,
          proposal_voting_ends_at: proposal.voting_ends_at,
          dao_slug: proposal.dao_slug,
        } satisfies VoteReadRow,
      ];
    });
  }

  /**
   * Aggregate the current votes for a proposal into a per-choice tally in one query. The projection
   * holds exactly one `superseded = 0` row per (proposal, voter), so a plain GROUP BY is the exact
   * tally — no argMax/dedup and no row-by-row transfer, regardless of turnout. `voting_power` is
   * UInt256, so `sum(...)` stays exact and the driver returns it as a decimal string.
   */
  async tallyForProposal(proposalId: string): Promise<ProposalTallyRow[]> {
    const rows = await this.ch
      .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('v'))
      .select([
        'v.primary_choice',
        sql<string>`sum(v.voting_power)`.as('voting_power'),
        sql<string>`count()`.as('voter_count'),
      ])
      .where('v.proposal_id', '=', proposalId)
      .where('v.superseded', '=', 0)
      .groupBy('v.primary_choice')
      .execute();

    return rows.map((row) => ({
      primary_choice: row.primary_choice,
      voting_power: row.voting_power,
      voter_count: Number(row.voter_count),
    }));
  }

  async listForActor(actorId: string): Promise<VoteReadRow[]> {
    const addresses = await this.pg
      .selectFrom('actor_address')
      .select('address')
      .where('actor_id', '=', actorId)
      .execute();
    if (addresses.length === 0) return [];

    const votes = await this.ch
      .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('v'))
      .select([
        'v.vote_id as id',
        'v.voting_power as voting_power_reported',
        'v.primary_choice',
        'v.voting_chain_id',
        'v.cast_at',
        'v.proposal_id',
        'v.voter_address',
      ])
      .where(
        'v.voter_address',
        'in',
        addresses.map((a) => a.address),
      )
      .where('v.superseded', '=', 0)
      .orderBy('v.cast_at', 'desc')
      .orderBy('v.vote_id', 'desc')
      .execute();

    const proposalIds = [...new Set(votes.map((row) => row.proposal_id))];
    const proposals =
      proposalIds.length === 0
        ? []
        : await this.pg
            .selectFrom('proposal as p')
            .innerJoin('dao as d', 'd.id', 'p.dao_id')
            .select([
              'p.id',
              'p.source_type',
              'p.source_id',
              'p.title',
              'p.state',
              'p.created_at',
              'p.voting_ends_at',
              'd.slug as dao_slug',
            ])
            .where('p.id', 'in', proposalIds)
            .execute();
    const proposalById = new Map(proposals.map((p) => [p.id, p]));

    return votes.flatMap((row) => {
      const proposal = proposalById.get(row.proposal_id);
      if (proposal === undefined) return [];
      return [
        {
          id: row.id,
          voting_chain_id: row.voting_chain_id,
          voting_power_reported: row.voting_power_reported,
          voting_power_verified: false,
          primary_choice: row.primary_choice,
          cast_at: chTimestampToDate(row.cast_at),
          reason: null,
          proposal_id: row.proposal_id,
          voter_actor_id: actorId,
          voter_address: row.voter_address.toLowerCase(),
          voter_display_name: null,
          proposal_source_type: proposal.source_type,
          proposal_source_id: proposal.source_id,
          proposal_title: proposal.title,
          proposal_state: proposal.state,
          proposal_created_at: proposal.created_at,
          proposal_voting_ends_at: proposal.voting_ends_at,
          dao_slug: proposal.dao_slug,
        } satisfies VoteReadRow,
      ];
    });
  }

  async findOneByVoter(proposalId: string, voterActorId: string): Promise<VoteReadRow | undefined> {
    const rows = await this.listForProposal({ proposalId, voterActorId });
    return rows[0];
  }

  // The source-agnostic breakdown: one entry synthesized from the core pipeline's primary_choice.
  // Sources with real multiplicity (e.g. Snapshot) surface their breakdown through their own read
  // extension (getVoteChoices); the API read layer prefers that and only falls back here.
  async findChoicesForVote(voteId: string): Promise<VoteChoiceReadRow[]> {
    const row = await this.ch
      .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('v'))
      .select(['v.primary_choice'])
      .where('v.vote_id', '=', voteId)
      .executeTakeFirst();

    if (row === undefined) return [];
    return [{ choice_index: row.primary_choice, weight: '1.0' }];
  }

  private async fetchProposal(proposalId: string): Promise<
    | {
        source_type: string;
        source_id: string;
        title: string | null;
        state: string;
        created_at: Date;
        voting_ends_at: Date | null;
        dao_slug: string;
      }
    | undefined
  > {
    return this.pg
      .selectFrom('proposal as p')
      .innerJoin('dao as d', 'd.id', 'p.dao_id')
      .select([
        'p.source_type',
        'p.source_id',
        'p.title',
        'p.state',
        'p.created_at',
        'p.voting_ends_at',
        'd.slug as dao_slug',
      ])
      .where('p.id', '=', proposalId)
      .executeTakeFirst();
  }

  private async fetchActorsByAddress(
    addresses: string[],
  ): Promise<Map<string, { id: string; display_name: string | null }>> {
    if (addresses.length === 0) return new Map();

    const rows = await this.pg
      .selectFrom('actor_address as aa')
      .innerJoin('actor as a', 'a.id', 'aa.actor_id')
      .select(['aa.address', 'a.id', 'a.display_name'])
      .where('aa.address', 'in', [...new Set(addresses)])
      .execute();

    return new Map(
      rows.map((row) => [row.address, { id: row.id, display_name: row.display_name }]),
    );
  }
}
