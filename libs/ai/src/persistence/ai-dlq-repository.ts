import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { NewAiDlq } from './schema.js';

export class AiDlqRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /** Upsert on the unique key: a repeat failure of the same input bumps one row (poison-safe). */
  async insert(row: NewAiDlq): Promise<void> {
    await this.db
      .insertInto('ai_dlq')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['feature_name', 'prompt_version', 'input_hash']).doUpdateSet({
          last_seen_at: row.last_seen_at,
          attempts: row.attempts,
          model: row.model,
          raw_output: (row.raw_output ?? null) as never,
          zod_error: row.zod_error as never,
        }),
      )
      .execute();
  }
}
