import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';
import { AiCostLogRepository } from './ai-cost-log-repository.js';
import { AiOutputRepository } from './ai-output-repository.js';
import type { CompletionRequest, CompletionResult, LLMClient } from '../llm/ports.js';
import { computeInputHash } from '../llm/provenance.js';

/** DAO / entity context for the cost-log row — not part of the completion request itself. */
export interface CostContext {
  daoId: string | null;
  entityReference: string | null;
}

export interface CachedCompletion<T> {
  output: T;
  cached: boolean;
}

/**
 * Content-hash cache in front of `LLMClient.complete()`. On a hit it returns the stored output with
 * NO API call; on a miss it calls the client, then atomically writes the `ai_output` cache row and
 * the `ai_cost_log` row. Transaction-composable: it reuses an existing transaction when handed one
 * (kysely@0.29 `Transaction.transaction()` throws — no savepoint nesting) and opens a new one only
 * at the top level, so callers may invoke it standalone or inside their own transaction.
 */
export class AiCompletionCache {
  private readonly outputs: AiOutputRepository;

  constructor(
    private readonly db: Kysely<PgDatabase>,
    private readonly llm: LLMClient,
  ) {
    this.outputs = new AiOutputRepository(db);
  }

  async complete<T>(req: CompletionRequest<T>, ctx: CostContext): Promise<CachedCompletion<T>> {
    const inputHash = computeInputHash(req.inputContent);
    const hit = await this.outputs.find(req.feature, req.promptVersion, inputHash);
    if (hit !== undefined) {
      // Stored output was schema-validated at write time under this (feature, prompt_version).
      return { output: hit.output as T, cached: true };
    }

    const result = await this.llm.complete(req);
    if (this.db.isTransaction) {
      await this.writeGenerated(this.db, req, inputHash, result, ctx);
    } else {
      await this.db
        .transaction()
        .execute((trx) => this.writeGenerated(trx, req, inputHash, result, ctx));
    }

    return { output: result.output, cached: false };
  }

  private async writeGenerated<T>(
    db: Kysely<PgDatabase>,
    req: CompletionRequest<T>,
    inputHash: string,
    result: CompletionResult<T>,
    ctx: CostContext,
  ): Promise<void> {
    const now = new Date();
    const costUsd = String(result.cost.totalUsd);
    await new AiCostLogRepository(db).insert({
      timestamp: now,
      feature_name: req.feature,
      model: req.model,
      input_tokens: result.cost.inputTokens,
      output_tokens: result.cost.outputTokens,
      cost_usd: costUsd,
      dao_id: ctx.daoId,
      entity_reference: ctx.entityReference,
    });
    await new AiOutputRepository(db).insert({
      feature_name: req.feature,
      prompt_version: req.promptVersion,
      input_hash: inputHash,
      model: req.model,
      output: result.output,
      cost_usd: costUsd,
      generated_at: now,
      source_provenance: result.provenance,
    });
  }
}
