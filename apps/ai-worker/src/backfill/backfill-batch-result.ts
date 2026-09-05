import {
  buildProvenance,
  computeInputHash,
  type AiCompletionCache,
  type AiCostLogRepository,
  type AiDlqRepository,
  type Clock,
  type CompletionRequest,
  type CompletionResult,
  type CostContext,
  type CostUsd,
} from '@libs/ai';
import { aiMetrics } from '../metrics/ai-metrics';

export interface BackfillBatchDeps {
  readonly cache: AiCompletionCache;
  readonly dlq: AiDlqRepository;
  readonly costs: AiCostLogRepository;
  readonly clock: Clock;
}

/**
 * Validate + persist one Anthropic batch result during a backfill, generic over the feature's schema.
 * Identical in shape to the steady-state batch services' `processResult` (a schema violation dead-letters
 * and still books the cost we already paid; a valid result persists to the content-hash cache with
 * provenance + records token metrics). Kept in the backfill module so a backfill bug can't reach the
 * live summary/forum drivers.
 */
export async function processBackfillBatchResult(
  req: CompletionRequest<unknown>,
  ctx: CostContext,
  parsed: unknown,
  cost: CostUsd,
  deps: BackfillBatchDeps,
): Promise<void> {
  const inputHash = computeInputHash(req.inputContent);
  const validated = req.schema.safeParse(parsed);
  if (!validated.success) {
    const now = new Date();
    await deps.dlq.insert({
      feature_name: req.feature,
      prompt_version: req.promptVersion,
      input_hash: inputHash,
      model: req.model,
      raw_output: parsed as never,
      zod_error: validated.error as never,
      attempts: 1,
      first_seen_at: now,
      last_seen_at: now,
    });
    await deps.costs.insert({
      timestamp: now,
      feature_name: req.feature,
      model: req.model,
      input_tokens: cost.inputTokens,
      output_tokens: cost.outputTokens,
      cache_creation_input_tokens: cost.cacheCreationInputTokens,
      cache_read_input_tokens: cost.cacheReadInputTokens,
      cost_usd: String(cost.totalUsd),
      dao_id: ctx.daoId,
      entity_reference: ctx.entityReference,
    });
    return;
  }
  const result: CompletionResult<unknown> = {
    output: validated.data,
    cost,
    provenance: buildProvenance(req, inputHash, deps.clock),
  };
  await deps.cache.persist(req, result, ctx);
  aiMetrics.tokensTotal.add(cost.inputTokens, { feature: req.feature, kind: 'input' });
  aiMetrics.tokensTotal.add(cost.outputTokens, { feature: req.feature, kind: 'output' });
}
