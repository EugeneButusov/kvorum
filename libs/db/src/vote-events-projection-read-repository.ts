import { sql, type Kysely } from 'kysely';
import type { ClickHouseDatabase } from './schema/clickhouse';
import type { VoteEventsProjectionTable } from './schema/projections';

export interface CurrentVoteRow {
  voteId: string;
  castAt: Date;
  blockNumber: string;
  logIndex: number;
  primaryChoice: number;
  votingPower: string;
  votingChainId: string;
}

export class VoteEventsProjectionReadRepository {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  async findCurrentVote(args: {
    daoId: string;
    proposalId: string;
    voterAddress: string;
  }): Promise<CurrentVoteRow | undefined> {
    // vote_events_projection is a VIEW over AggregatingMergeTree — each (dao, proposal,
    // voter, block, log, vote_id) tuple is exactly one row, so no FINAL or LIMIT 1 BY
    // needed. The identity guard (commit 0.0) ensures at most one superseded=0 row per
    // (dao, proposal, voter) at any time. ORDER BY + LIMIT 1 is a defensive fallback.
    return this.chDb
      .selectFrom(sql<VoteEventsProjectionTable>`vote_events_projection`.as('vef'))
      .select([
        'vef.vote_id as voteId',
        'vef.cast_at as castAt',
        'vef.block_number as blockNumber',
        'vef.log_index as logIndex',
        'vef.primary_choice as primaryChoice',
        'vef.voting_power as votingPower',
        'vef.voting_chain_id as votingChainId',
      ])
      .where('vef.dao_id', '=', args.daoId)
      .where('vef.proposal_id', '=', args.proposalId)
      .where('vef.voter_address', '=', args.voterAddress)
      .where('vef.superseded', '=', 0)
      .orderBy('vef.cast_at', 'desc')
      .orderBy('vef.block_number', 'desc')
      .orderBy('vef.log_index', 'desc')
      .limit(1)
      .executeTakeFirst() as Promise<CurrentVoteRow | undefined>;
  }
}
