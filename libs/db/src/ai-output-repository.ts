import type { Kysely } from 'kysely';
import type { AiOutput, NewAiOutput, PgDatabase } from './schema/pg';

export class AiOutputRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async find(
    featureName: string,
    promptVersion: string,
    inputHash: string,
  ): Promise<AiOutput | undefined> {
    return this.db
      .selectFrom('ai_output')
      .selectAll()
      .where('feature_name', '=', featureName)
      .where('prompt_version', '=', promptVersion)
      .where('input_hash', '=', inputHash)
      .executeTakeFirst();
  }

  /** Immutable append. On a unique-key conflict the insert is a no-op; returns the winning row. */
  async insert(row: NewAiOutput): Promise<AiOutput> {
    const inserted = await this.db
      .insertInto('ai_output')
      .values(row)
      .onConflict((oc) => oc.columns(['feature_name', 'prompt_version', 'input_hash']).doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted !== undefined) {
      return inserted;
    }
    const existing = await this.find(row.feature_name, row.prompt_version, row.input_hash);
    if (existing === undefined) {
      throw new Error('ai_output insert conflicted but no existing row was found');
    }
    return existing;
  }
}
