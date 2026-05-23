import type { Kysely, Transaction } from 'kysely';
import type { NewVotingPowerSnapshotRun, PgDatabase, VotingPowerSnapshotRun } from './schema/pg';

interface InsertInProgressInput {
  proposal_id: string;
  voting_power_block: string;
  started_at: Date;
}

interface CompletionInput {
  rows_inserted: number;
  population_size: number;
  sample_size: number;
  fallback_engaged: boolean;
  completed_at: Date;
}

export class VotingPowerSnapshotRunRepository {
  constructor(private readonly db: Kysely<PgDatabase> | Transaction<PgDatabase>) {}

  async insertInProgress(row: InsertInProgressInput): Promise<void> {
    const insertRow: NewVotingPowerSnapshotRun = {
      ...row,
      status: 'in_progress',
      snapshot_attempt_count: 0,
      last_error: null,
      last_attempt_at: null,
      rows_inserted: 0,
      population_size: 0,
      sample_size: 0,
      fallback_engaged: false,
      completed_at: null,
    };

    await this.db.insertInto('voting_power_snapshot_run').values(insertRow).execute();
  }

  async incrementAttempt(
    proposalId: string,
    lastError: string,
    lastAttemptAt: Date,
  ): Promise<{ attempts: number }> {
    const row = await this.db
      .updateTable('voting_power_snapshot_run')
      .set((eb) => ({
        snapshot_attempt_count: eb('snapshot_attempt_count', '+', 1),
        last_error: lastError,
        last_attempt_at: lastAttemptAt,
      }))
      .where('proposal_id', '=', proposalId)
      .returning('snapshot_attempt_count')
      .executeTakeFirstOrThrow();

    return { attempts: row.snapshot_attempt_count };
  }

  async markCompleted(proposalId: string, completion: CompletionInput): Promise<void> {
    await this.db
      .updateTable('voting_power_snapshot_run')
      .set({
        status: 'completed',
        rows_inserted: completion.rows_inserted,
        population_size: completion.population_size,
        sample_size: completion.sample_size,
        fallback_engaged: completion.fallback_engaged,
        completed_at: completion.completed_at,
        last_error: null,
      })
      .where('proposal_id', '=', proposalId)
      .executeTakeFirst();
  }

  async findByProposalId(proposalId: string): Promise<VotingPowerSnapshotRun | undefined> {
    return this.db
      .selectFrom('voting_power_snapshot_run')
      .selectAll()
      .where('proposal_id', '=', proposalId)
      .executeTakeFirst();
  }

  async findInProgress(proposalId: string): Promise<VotingPowerSnapshotRun | undefined> {
    return this.db
      .selectFrom('voting_power_snapshot_run')
      .selectAll()
      .where('proposal_id', '=', proposalId)
      .where('status', '=', 'in_progress')
      .executeTakeFirst();
  }
}
