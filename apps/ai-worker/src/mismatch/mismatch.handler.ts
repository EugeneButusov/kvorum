import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AiCompletionCache,
  AiDlqRepository,
  AiOutputRepository,
  computeInputHash,
  LlmSchemaViolationError,
  type CompletionRequest,
  type CompletionResult,
  type CostContext,
  type LLMClient,
  type MismatchAnalysis,
} from '@libs/ai';
import { ProposalRepository } from '@libs/db';
import type { Proposal } from '@libs/db';
import { MismatchAssembler } from './mismatch.assembler';
import { AiBudgetState } from '../budget/ai-budget-state';
import type { AiFeatureHandler } from '../consumer/ai-feature-handler';
import { AiFeatureHandlerRegistry } from '../consumer/ai-feature-handler.registry';
import { LLM_CLIENT } from '../llm/llm.provider';
import { aiMetrics } from '../metrics/ai-metrics';
import type { AiJob } from '../queue/ai-queue-names';
import { AiTriggerConfig } from '../trigger/ai-trigger-config';

const FEATURE = 'mismatch_detector';

function parseProposalRef(entityRef: string): string | null {
  const [type, id] = entityRef.split(':');
  return type === 'proposal' && id ? id : null;
}

/**
 * Calldata-vs-prose mismatch job handler (SPEC §5.6, M5-3.1). The scanner enqueues one `ai_mismatch`
 * job per binding proposal whose `proposal_action` rows are all decoded. This handler runs the
 * **synchronous** analysis (SPEC: sync on `active`): assemble description + decoded actions, call
 * Sonnet, validate + persist. Snapshot proposals are non-binding and skipped. The content-hash cache
 * makes re-enqueues idempotent. Schema violations dead-letter (the client retries once first).
 */
@Injectable()
export class MismatchHandler implements AiFeatureHandler, OnModuleInit {
  private readonly logger = new Logger('MismatchHandler');

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LLMClient,
    private readonly proposals: ProposalRepository,
    private readonly assembler: MismatchAssembler,
    private readonly outputs: AiOutputRepository,
    private readonly cache: AiCompletionCache,
    private readonly dlq: AiDlqRepository,
    private readonly config: AiTriggerConfig,
    private readonly budget: AiBudgetState,
    private readonly registry: AiFeatureHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(FEATURE, this);
  }

  async handle(job: AiJob): Promise<void> {
    if (!this.config.isEnabled(FEATURE) || this.budget.isDisabled(FEATURE)) return;
    const id = parseProposalRef(job.entityRef);
    if (id === null) return;
    const proposal = await this.proposals.findById(id);
    // The scan guarantees binding + all-decoded; guard defensively against a mis-routed job.
    if (proposal === undefined || !proposal.binding) return;
    await this.analyze(proposal);
  }

  private async analyze(proposal: Proposal): Promise<void> {
    const { rendered, ctx } = await this.assembler.assemble(proposal);
    const req: CompletionRequest<MismatchAnalysis> = {
      feature: rendered.feature,
      promptVersion: rendered.promptVersion,
      model: rendered.model,
      schema: rendered.schema,
      messages: rendered.messages,
      mode: 'sync',
      inputContent: rendered.inputContent,
    };
    const inputHash = computeInputHash(req.inputContent);
    const existing = await this.outputs.find(req.feature, req.promptVersion, inputHash);
    if (existing !== undefined) {
      aiMetrics.cacheHitsTotal.add(1, { feature: FEATURE });
      return;
    }

    const start = Date.now();
    let result: CompletionResult<MismatchAnalysis>;
    try {
      result = await this.llm.complete(req);
    } catch (err) {
      if (err instanceof LlmSchemaViolationError) {
        await this.deadLetter(err, ctx);
        return;
      }
      throw err; // transient (rate-limit / network): let the job retry → job DLQ
    }

    await this.cache.persist(req, result, ctx);
    aiMetrics.latencySeconds.record((Date.now() - start) / 1000, { feature: FEATURE });
    aiMetrics.tokensTotal.add(result.cost.inputTokens, { feature: FEATURE, kind: 'input' });
    aiMetrics.tokensTotal.add(result.cost.outputTokens, { feature: FEATURE, kind: 'output' });
    this.logger.log('ai_mismatch_completed', { entityRef: ctx.entityReference });
  }

  private async deadLetter(err: LlmSchemaViolationError, ctx: CostContext): Promise<void> {
    const now = new Date();
    await this.dlq.insert({
      feature_name: err.feature,
      prompt_version: err.promptVersion,
      input_hash: err.inputHash,
      model: err.model,
      raw_output: err.rawOutput as never,
      zod_error: err.zodError as never,
      attempts: err.attempts,
      first_seen_at: now,
      last_seen_at: now,
    });
    this.logger.warn('ai_mismatch_schema_violation', { entityRef: ctx.entityReference });
  }
}
