import type { Kysely, Transaction } from 'kysely';
import type { MirrorEtlRun, PgDatabase } from './schema/pg';

interface StartCycleInput {
  job_name: string;
  watermark_from: Date;
  watermark_to: Date;
}

interface CompletionInput {
  rows_written: number;
  exact_match: boolean;
  drift_ratio: number;
  completed_at: Date;
}

export class MirrorEtlRunRepository {
  constructor(private readonly db: Kysely<PgDatabase> | Transaction<PgDatabase>) {}

  async startCycle(input: StartCycleInput): Promise<{ attempt_count: number }> {
    const row = await this.db
      .insertInto('mirror_etl_run')
      .values({
        ...input,
        status: 'in_progress',
        last_error: null,
      })
      .onConflict((oc) =>
        oc.columns(['job_name', 'watermark_from']).doUpdateSet((eb) => ({
          watermark_to: input.watermark_to,
          attempt_count: eb('mirror_etl_run.attempt_count', '+', 1),
          status: 'in_progress',
          last_error: null,
          started_at: new Date(),
          completed_at: null,
        })),
      )
      .returning('attempt_count')
      .executeTakeFirstOrThrow();

    return { attempt_count: row.attempt_count };
  }

  async markCompleted(jobName: string, watermarkFrom: Date, input: CompletionInput): Promise<void> {
    await this.db
      .updateTable('mirror_etl_run')
      .set({
        status: 'completed',
        rows_written: input.rows_written,
        exact_match: input.exact_match,
        drift_ratio: input.drift_ratio,
        completed_at: input.completed_at,
        last_error: null,
      })
      .where('job_name', '=', jobName)
      .where('watermark_from', '=', watermarkFrom)
      .executeTakeFirst();
  }

  async markFailed(jobName: string, watermarkFrom: Date, lastError: string): Promise<void> {
    await this.db
      .updateTable('mirror_etl_run')
      .set({
        status: 'failed',
        last_error: lastError,
      })
      .where('job_name', '=', jobName)
      .where('watermark_from', '=', watermarkFrom)
      .executeTakeFirst();
  }

  async findLastSuccess(jobName: string): Promise<MirrorEtlRun | undefined> {
    return this.db
      .selectFrom('mirror_etl_run')
      .selectAll()
      .where('job_name', '=', jobName)
      .where('status', '=', 'completed')
      .orderBy('completed_at', 'desc')
      .executeTakeFirst();
  }
}
