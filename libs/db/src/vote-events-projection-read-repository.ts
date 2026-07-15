import { sql, type Kysely } from 'kysely';
import { chTimestampToDate } from './ch-timestamp';
import type { ClickHouseDatabase } from './schema/clickhouse';
import type { VoteEventsProjectionTable } from './schema/projections';

export interface CurrentVoteRow {
  vote_id: string;
  cast_at: Date;
  block_number: string;
  log_index: number;
  primary_choice: number;
  voting_power: string;
  voting_chain_id: string;
}

export interface ProposalVoterRow {
  voter_address: string;
  voting_power: string;
}

export class VoteEventsProjectionReadRepository {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  async listVotersForProposal(args: {
    daoId: string;
    proposalId: string;
  }): Promise<ProposalVoterRow[]> {
    return this.chDb
      .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('vef'))
      .select([
        'vef.voter_address',
        // toString() for the same UInt256→JS-number precision loss as findCurrentVote.
        sql<string>`
          toString(argMax(
            vef.voting_power,
            tuple(vef.cast_at, vef.block_number, vef.log_index)
          ))
        `.as('voting_power'),
      ])
      .where('vef.dao_id', '=', args.daoId)
      .where('vef.proposal_id', '=', args.proposalId)
      .where('vef.superseded', '=', 0)
      .groupBy('vef.voter_address')
      .orderBy('vef.voter_address', 'asc')
      .execute() as Promise<ProposalVoterRow[]>;
  }

  async findCurrentVote(args: {
    daoId: string;
    proposalId: string;
    voterAddress: string;
  }): Promise<CurrentVoteRow | undefined> {
    // vote_events_projection is a VIEW over AggregatingMergeTree — each (dao, proposal,
    // voter, block, log, vote_id) tuple is exactly one row, so no FINAL or LIMIT 1 BY
    // needed. The identity guard (commit 0.0) ensures at most one superseded=0 row per
    // (dao, proposal, voter) at any time. ORDER BY + LIMIT 1 is a defensive fallback.
    const row = (await this.chDb
      .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('vef'))
      .select([
        'vef.vote_id',
        'vef.cast_at',
        'vef.block_number',
        'vef.log_index',
        'vef.primary_choice',
        // toString(): the kysely-clickhouse client deserializes a bare UInt256 column
        // as a JS number, so a large voting_power (> 2^53) loses precision and, on the
        // supersession re-insert, serialises as scientific notation (1.5e+25) which
        // ClickHouse's UInt256 parser rejects — stalling all vote derivation. Force a
        // quoted string so the value round-trips exactly.
        sql<string>`toString(vef.voting_power)`.as('voting_power'),
        'vef.voting_chain_id',
      ])
      .where('vef.dao_id', '=', args.daoId)
      .where('vef.proposal_id', '=', args.proposalId)
      .where('vef.voter_address', '=', args.voterAddress)
      .where('vef.superseded', '=', 0)
      .orderBy('vef.cast_at', 'desc')
      .orderBy('vef.block_number', 'desc')
      .orderBy('vef.log_index', 'desc')
      .limit(1)
      .executeTakeFirst()) as
      | (Omit<CurrentVoteRow, 'cast_at'> & { cast_at: string | Date })
      | undefined;

    if (row === undefined) return undefined;
    // ClickHouse returns DateTime64 as a zoneless UTC string; honor the typed Date
    // contract so downstream ordering (isNewerVote) compares real instants, not strings.
    return { ...row, cast_at: chTimestampToDate(row.cast_at) };
  }
}
