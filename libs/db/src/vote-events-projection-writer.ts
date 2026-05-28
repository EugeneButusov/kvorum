import type { Generated, Kysely } from 'kysely';
import type { ClickHouseDatabase } from './schema/clickhouse';

export interface NewVoteEventsProjectionRow {
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

type VoteEventsProjectionTable = {
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

type VoteEventsProjectionDatabase = ClickHouseDatabase & {
  vote_events_projection: VoteEventsProjectionTable;
};

export class VoteEventsProjectionWriter {
  constructor(private readonly chDb: Kysely<VoteEventsProjectionDatabase>) {}

  async insertBatch(rows: readonly NewVoteEventsProjectionRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.chDb
      .insertInto('vote_events_projection')
      .values([...rows])
      .execute();
  }
}
