import { sql, type Generated, type Kysely } from 'kysely';
import type { ClickHouseDatabase } from './schema/clickhouse';

export interface CurrentVoteRow {
  voteId: string;
  castAt: Date;
  blockNumber: string;
  logIndex: number;
  primaryChoice: number;
  votingPower: string;
}

export interface NewVoteEventsFlatRow {
  vote_id: string;
  dao_id: string;
  proposal_id: string;
  voter_address: string;
  primary_choice: number;
  voting_power: string;
  cast_at: Date;
  block_number: string;
  log_index: number;
  superseded: number;
  superseded_at: Date | null;
  superseded_by_vote_id: string | null;
}

type VoteEventsFlatTable = {
  vote_id: string;
  dao_id: string;
  proposal_id: string;
  voter_address: string;
  primary_choice: number;
  voting_power: string;
  cast_at: Date;
  block_number: string;
  log_index: number;
  superseded: number;
  superseded_at: Date | null;
  superseded_by_vote_id: string | null;
  version: Generated<Date>;
};

type VoteEventsFlatDatabase = ClickHouseDatabase & {
  vote_events_flat: VoteEventsFlatTable;
};

export class VoteEventsFlatWriter {
  constructor(private readonly chDb: Kysely<VoteEventsFlatDatabase>) {}

  async findCurrentVote(args: {
    daoId: string;
    proposalId: string;
    voterAddress: string;
  }): Promise<CurrentVoteRow | undefined> {
    return this.chDb
      .selectFrom(sql<VoteEventsFlatTable>`vote_events_flat FINAL`.as('vef'))
      .select([
        'vef.vote_id as voteId',
        'vef.cast_at as castAt',
        'vef.block_number as blockNumber',
        'vef.log_index as logIndex',
        'vef.primary_choice as primaryChoice',
        'vef.voting_power as votingPower',
      ])
      .where('vef.dao_id', '=', args.daoId)
      .where('vef.proposal_id', '=', args.proposalId)
      .where('vef.voter_address', '=', args.voterAddress)
      .where('vef.superseded', '=', 0)
      .executeTakeFirst() as Promise<CurrentVoteRow | undefined>;
  }

  async insertBatch(rows: readonly NewVoteEventsFlatRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.chDb
      .insertInto('vote_events_flat')
      .values([...rows])
      .execute();
  }
}
