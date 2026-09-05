import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { BatchItemDescriptor } from '../llm/ports.js';

/** A submitted, not-yet-drained batch, as needed to resume poll → price → persist after a restart. */
export interface OpenBatch {
  id: string;
  provider: string;
  providerBatchId: string;
  feature: string;
  pendingCursor: string | null;
  items: BatchItemDescriptor[];
}

/**
 * Durable in-flight batch tracking (#617). A row exists only while a batch is in flight; the drain
 * deletes it in the same transaction that persists its results, so the DB is the single source of
 * truth for "is there an open batch for this feature" across restarts.
 */
export class AiBatchRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async insert(
    batch: {
      provider: string;
      providerBatchId: string;
      feature: string;
      pendingCursor: string | null;
      items: BatchItemDescriptor[];
      submittedAt: Date;
    },
    executor: Kysely<PgDatabase> = this.db,
  ): Promise<void> {
    await executor
      .insertInto('ai_batch')
      .values({
        provider: batch.provider,
        provider_batch_id: batch.providerBatchId,
        feature: batch.feature,
        pending_cursor: batch.pendingCursor,
        items: batch.items as never, // jsonb
        submitted_at: batch.submittedAt,
      })
      .execute();
  }

  /** The open batch for a feature (there is at most one in flight at a time; oldest wins if not). */
  async findOpenByFeature(
    feature: string,
    executor: Kysely<PgDatabase> = this.db,
  ): Promise<OpenBatch | undefined> {
    const row = await executor
      .selectFrom('ai_batch')
      .selectAll()
      .where('feature', '=', feature)
      .orderBy('submitted_at', 'asc')
      .limit(1)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    return {
      id: row.id,
      provider: row.provider,
      providerBatchId: row.provider_batch_id,
      feature: row.feature,
      pendingCursor: row.pending_cursor,
      items: row.items as BatchItemDescriptor[],
    };
  }

  async deleteById(id: string, executor: Kysely<PgDatabase> = this.db): Promise<void> {
    await executor.deleteFrom('ai_batch').where('id', '=', id).execute();
  }
}
