import type { Kysely, Transaction } from 'kysely';
import type { NewVoteChoice, PgDatabase } from './schema/pg';

export interface InsertEventVoteRow {
  proposal_id: string;
  voter_actor_id: string;
  voting_power_reported: string;
  cast_at: Date;
  block_number: string;
  tx_index: number;
  tx_hash: string;
  log_index: number;
  primary_choice: number;
  reason: string | null;
}

export interface InsertVoteResult {
  inserted: boolean;
  voteId?: string;
}

export class VoteRepository {
  constructor(private readonly db: Kysely<PgDatabase> | Transaction<PgDatabase>) {}

  async insertVote(row: InsertEventVoteRow): Promise<InsertVoteResult> {
    const inserted = await this.db
      .insertInto('vote')
      .values({
        ...row,
        voting_power_computed: null,
        voting_power_verified: false,
        voting_power_discrepancy: null,
        source_id: null,
        superseded_by_vote_id: null,
        superseded_at: null,
      })
      .onConflict((oc) =>
        oc
          .columns(['proposal_id', 'tx_hash', 'log_index'])
          .where('tx_hash', 'is not', null)
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst();

    if (inserted === undefined) return { inserted: false };
    return { inserted: true, voteId: inserted.id };
  }

  async insertVoteChoice(voteId: string, choice: Omit<NewVoteChoice, 'vote_id'>): Promise<void> {
    await this.db
      .insertInto('vote_choice')
      .values({
        vote_id: voteId,
        choice_index: choice.choice_index,
        weight: choice.weight,
      })
      .onConflict((oc) => oc.columns(['vote_id', 'choice_index']).doNothing())
      .execute();
  }
}
