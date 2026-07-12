import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { NewAiJobDlq } from './schema.js';

export class AiJobDlqRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /** Upsert on (feature, entity_ref): a repeat exhaustion of the same entity's job bumps one row
   *  (poison-safe), preserving first_seen_at. Job-execution failure grain — distinct from ai_dlq. */
  async insert(row: NewAiJobDlq): Promise<void> {
    await this.db
      .insertInto('ai_job_dlq')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['feature', 'entity_ref']).doUpdateSet({
          last_seen_at: row.last_seen_at,
          attempts: row.attempts,
          input_hash: (row.input_hash ?? null) as never,
          payload: row.payload as never,
          error: row.error as never,
        }),
      )
      .execute();
  }
}
