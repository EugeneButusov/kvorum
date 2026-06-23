import { sql, type Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { NewAragonProposalMetadata } from '../../persistence/schema';

/**
 * Per-source PG extension repo for Lido Aragon proposals.
 *
 * The event-only projection seeds the metadata row at StartVote (`app_address`;
 * pct/phase-times left NULL) and stamps `executed_at` on ExecuteVote. The getVote
 * state reconciler fills the NULL pct/phase-time columns and drives
 * `last_reconcile_check_block`.
 */
export class AragonProposalRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /** The Aragon Voting app address from the dao_source config (= the ingester's
   *  `voting_address`). Config-driven so it can't drift from a hardcoded constant. */
  async findVotingAddress(daoSourceId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('dao_source')
      .select(sql<string | null>`source_config ->> 'voting_address'`.as('voting_address'))
      .where('id', '=', daoSourceId)
      .executeTakeFirst();

    return row?.voting_address ?? undefined;
  }

  async insertMetadata(row: NewAragonProposalMetadata): Promise<void> {
    await this.db
      .insertInto('aragon_proposal_metadata')
      .values(row)
      .onConflict((oc) => oc.column('proposal_id').doNothing())
      .execute();
  }

  async setExecutedAt(proposalId: string, executedAt: Date): Promise<void> {
    await this.db
      .updateTable('aragon_proposal_metadata')
      .set({ executed_at: executedAt })
      .where('proposal_id', '=', proposalId)
      .execute();
  }
}
