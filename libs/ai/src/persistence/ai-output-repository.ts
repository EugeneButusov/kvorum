import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { AiOutput, NewAiOutput } from './schema.js';

export class AiOutputRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async find(
    featureName: string,
    promptVersion: string,
    inputHash: string,
    executor: Kysely<PgDatabase> = this.db,
  ): Promise<AiOutput | undefined> {
    return executor
      .selectFrom('ai_output')
      .selectAll()
      .where('feature_name', '=', featureName)
      .where('prompt_version', '=', promptVersion)
      .where('input_hash', '=', inputHash)
      .executeTakeFirst();
  }

  /**
   * Immutable append. On a unique-key conflict the insert is a no-op; returns the winning row.
   * `executor` (a transaction handle) overrides `this.db` so one repo instance can participate
   * in a caller's transaction — kysely can't rebind an already-constructed builder to a new tx.
   */
  async insert(row: NewAiOutput, executor: Kysely<PgDatabase> = this.db): Promise<AiOutput> {
    const inserted = await executor
      .insertInto('ai_output')
      .values(row)
      .onConflict((oc) => oc.columns(['feature_name', 'prompt_version', 'input_hash']).doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted !== undefined) {
      return inserted;
    }
    const existing = await this.find(
      row.feature_name,
      row.prompt_version,
      row.input_hash,
      executor,
    );
    if (existing === undefined) {
      throw new Error('ai_output insert conflicted but no existing row was found');
    }
    return existing;
  }
}
