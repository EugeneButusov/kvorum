import type { Kysely } from 'kysely';
import {
  computeInputHash,
  type AiBackfillCursorRepository,
  type AiBatchRepository,
  type BatchHandle,
  type BatchItemDescriptor,
  type CompletionRequest,
  type CostContext,
  type FacadeBatchItem,
  type LLMClient,
} from '@libs/ai';
import type { PgDatabase } from '@libs/db';
import { persistBatchItemResult, type PersistBatchDeps } from './persist-batch-item';

/** Build the durable, restart-safe descriptor for a batch item from its request + cost context. */
export function toDescriptor(
  item: FacadeBatchItem<unknown>,
  ctx: CostContext,
): BatchItemDescriptor {
  const req: CompletionRequest<unknown> = item.request;
  return {
    customId: item.customId,
    feature: req.feature,
    promptVersion: req.promptVersion,
    model: req.model,
    inputHash: computeInputHash(req.inputContent),
    ...(req.routingReason !== undefined ? { routingReason: req.routingReason } : {}),
    daoId: ctx.daoId,
    entityReference: ctx.entityReference,
  };
}

export type PollOutcome =
  | { state: 'idle' } // no open batch — the caller may scan + submit
  | { state: 'waiting' } // an open batch is still processing on the provider
  | { state: 'drained'; pendingCursor: string | null }; // ended → persisted + row deleted

/**
 * The durable in-flight-batch gateway shared by all three batch drivers. The `ai_batch` table is the
 * single source of truth for "is there an open batch for this feature", so a restart is a non-event:
 * the next tick finds the row, re-polls, and persists. `pollOpen` drains a finished batch in ONE
 * transaction (persist every result + commit the backfill cursor + delete the row), so a mid-drain
 * restart rolls back and re-polls cleanly, never double-booking `ai_cost_log`.
 */
export class DurableBatch {
  constructor(
    private readonly db: Kysely<PgDatabase>,
    private readonly llm: LLMClient,
    private readonly batches: AiBatchRepository,
    private readonly cursors: AiBackfillCursorRepository,
    private readonly persistDeps: PersistBatchDeps,
  ) {}

  async pollOpen(feature: string): Promise<PollOutcome> {
    const open = await this.batches.findOpenByFeature(feature);
    if (open === undefined) return { state: 'idle' };

    const modelByCustomId: Record<string, string> = {};
    for (const item of open.items) modelByCustomId[item.customId] = item.model;
    const res = await this.llm.fetchBatch(
      { id: open.providerBatchId, provider: open.provider },
      modelByCustomId,
    );
    if (res.status !== 'ended') return { state: 'waiting' };

    const byCustomId = new Map(open.items.map((item) => [item.customId, item]));
    await this.db.transaction().execute(async (trx) => {
      for (const result of res.results) {
        const descriptor = byCustomId.get(result.customId);
        if (descriptor === undefined) continue;
        await persistBatchItemResult(descriptor, result.parsed, result.cost, this.persistDeps, trx);
      }
      if (open.pendingCursor !== null) {
        await this.cursors.upsert(feature, open.pendingCursor, trx);
      }
      // Row deleted in the same tx: a terminal (ended/canceled/expired) batch is never re-polled.
      await this.batches.deleteById(open.id, trx);
    });
    return { state: 'drained', pendingCursor: open.pendingCursor };
  }

  /** Record a freshly submitted batch as the durable in-flight state for `feature`. */
  async record(
    feature: string,
    handle: BatchHandle,
    descriptors: BatchItemDescriptor[],
    pendingCursor: string | null,
  ): Promise<void> {
    await this.batches.insert({
      provider: handle.provider,
      providerBatchId: handle.id,
      feature,
      pendingCursor,
      items: descriptors,
      submittedAt: new Date(),
    });
  }

  /** Read the durable full-history walk position for a backfill feature (null = scan from start). */
  getCursor(feature: string): Promise<string | null> {
    return this.cursors.get(feature);
  }

  /** Advance the durable walk position without a batch (e.g. an all-cache-hit page — anti-stall). */
  advanceCursor(feature: string, cursor: string): Promise<void> {
    return this.cursors.upsert(feature, cursor);
  }
}
