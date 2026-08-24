import type { Kysely } from 'kysely';
import {
  batchSchemaFor,
  buildProvenanceFromFields,
  type AiCostLogRepository,
  type AiDlqRepository,
  type AiOutputRepository,
  type BatchItemDescriptor,
  type Clock,
  type CostUsd,
} from '@libs/ai';
import type { PgDatabase } from '@libs/db';
import { aiMetrics } from '../metrics/ai-metrics';

export interface PersistBatchDeps {
  readonly outputs: AiOutputRepository;
  readonly costs: AiCostLogRepository;
  readonly dlq: AiDlqRepository;
  readonly clock: Clock;
}

/**
 * Validate + persist one Anthropic batch result from its durable {@link BatchItemDescriptor}, inside
 * the caller's transaction (`executor`). A schema violation dead-letters and still books the cost we
 * already paid; a valid result writes the content-hash cache (`ai_output`) + cost ledger and records
 * token metrics. Shared by the live summary/forum drivers, the backfill driver, AND the post-restart
 * resume path — which has only the descriptor, not the original `CompletionRequest` (no live Zod
 * schema, no `inputContent`). The schema is resolved from the feature; `input_hash` is carried on the
 * descriptor. Because the whole drain runs in one transaction, re-polling after a mid-drain restart
 * rolls back cleanly and never double-books `ai_cost_log`.
 */
export async function persistBatchItemResult(
  descriptor: BatchItemDescriptor,
  parsed: unknown,
  cost: CostUsd,
  deps: PersistBatchDeps,
  executor: Kysely<PgDatabase>,
): Promise<void> {
  const now = new Date();
  const costUsd = String(cost.totalUsd);
  const costRow = {
    timestamp: now,
    feature_name: descriptor.feature,
    model: descriptor.model,
    input_tokens: cost.inputTokens,
    output_tokens: cost.outputTokens,
    cost_usd: costUsd,
    dao_id: descriptor.daoId,
    entity_reference: descriptor.entityReference,
  };

  const validated = batchSchemaFor(descriptor.feature).safeParse(parsed);
  if (!validated.success) {
    await deps.dlq.insert(
      {
        feature_name: descriptor.feature,
        prompt_version: descriptor.promptVersion,
        input_hash: descriptor.inputHash,
        model: descriptor.model,
        raw_output: parsed as never,
        zod_error: validated.error as never,
        attempts: 1,
        first_seen_at: now,
        last_seen_at: now,
      },
      executor,
    );
    await deps.costs.insert(costRow, executor);
    return;
  }

  const provenance = buildProvenanceFromFields(
    {
      feature: descriptor.feature,
      model: descriptor.model,
      promptVersion: descriptor.promptVersion,
      ...(descriptor.routingReason !== undefined
        ? { routingReason: descriptor.routingReason }
        : {}),
    },
    descriptor.inputHash,
    deps.clock,
  );
  await deps.costs.insert(costRow, executor);
  await deps.outputs.insert(
    {
      feature_name: descriptor.feature,
      prompt_version: descriptor.promptVersion,
      input_hash: descriptor.inputHash,
      model: descriptor.model,
      output: validated.data,
      cost_usd: costUsd,
      generated_at: now,
      source_provenance: provenance,
    },
    executor,
  );
  aiMetrics.tokensTotal.add(cost.inputTokens, { feature: descriptor.feature, kind: 'input' });
  aiMetrics.tokensTotal.add(cost.outputTokens, { feature: descriptor.feature, kind: 'output' });
}
