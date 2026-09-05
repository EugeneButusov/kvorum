import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { CostContext } from './ai-completion-cache.js';
import { AiCostLogRepository } from './ai-cost-log-repository.js';
import { ProposalEmbeddingRepository } from './proposal-embedding-repository.js';

export interface EmbeddingWrite {
  proposalId: string;
  embeddingVersion: string;
  inputHash: string;
  /** pgvector text form, e.g. `'[0.1,0.2,…]'`. */
  vector: string;
  model: string;
  inputTokens: number;
  costUsd: number;
}

/**
 * Atomically persists a proposal embedding: the vector row (`proposal_embedding`, upserted) AND the
 * cost-ledger row (`ai_cost_log`) in one transaction. The cost row is what makes `'embedding'` spend
 * visible to the budget cap (`sumCostForFeatureSince`); it must land with the vector or the cap
 * under-counts. This is a write-only persister (the cache-check — reading an existing row and
 * comparing `input_hash` — lives in the handler via `ProposalEmbeddingRepository`). Transaction-
 * composable: reuses a handed-in transaction and opens a new one only at the top level (kysely@0.29
 * forbids savepoint nesting).
 */
export class ProposalEmbeddingWriter {
  constructor(
    private readonly db: Kysely<PgDatabase>,
    private readonly embeddings: ProposalEmbeddingRepository,
    private readonly costs: AiCostLogRepository,
  ) {}

  async persist(write: EmbeddingWrite, ctx: CostContext): Promise<void> {
    if (this.db.isTransaction) {
      await this.write(this.db, write, ctx);
    } else {
      await this.db.transaction().execute((trx) => this.write(trx, write, ctx));
    }
  }

  private async write(
    executor: Kysely<PgDatabase>,
    write: EmbeddingWrite,
    ctx: CostContext,
  ): Promise<void> {
    const now = new Date();
    const costUsd = String(write.costUsd);
    await this.costs.insert(
      {
        timestamp: now,
        feature_name: 'embedding',
        model: write.model,
        input_tokens: write.inputTokens,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cost_usd: costUsd,
        dao_id: ctx.daoId,
        entity_reference: ctx.entityReference,
      },
      executor,
    );
    await this.embeddings.upsert(
      {
        proposal_id: write.proposalId,
        embedding_version: write.embeddingVersion,
        input_hash: write.inputHash,
        embedding: write.vector,
        generated_at: now,
        cost_usd: costUsd,
      },
      executor,
    );
  }
}
