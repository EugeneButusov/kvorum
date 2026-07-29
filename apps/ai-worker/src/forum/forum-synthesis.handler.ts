import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AiCompletionCache,
  AiDlqRepository,
  AiOutputRepository,
  chooseForumModel,
  computeInputHash,
  forumSynthesisInputContent,
  LlmSchemaViolationError,
  type CompletionRequest,
  type CompletionResult,
  type CostContext,
  type ForumSynthesis,
  type LLMClient,
} from '@libs/ai';
import { ForumThreadReadRepository, type ForumThreadForSynthesis } from '@sources/forum';
import { ForumSynthesisAssembler } from './forum-synthesis.assembler';
import { AiBudgetState } from '../budget/ai-budget-state';
import type { AiFeatureHandler } from '../consumer/ai-feature-handler';
import { AiFeatureHandlerRegistry } from '../consumer/ai-feature-handler.registry';
import { LLM_CLIENT } from '../llm/llm.provider';
import { aiMetrics } from '../metrics/ai-metrics';
import type { AiJob } from '../queue/ai-queue-names';
import { AiTriggerConfig } from '../trigger/ai-trigger-config';

const FEATURE = 'forum_synthesizer';

function parseThreadRef(entityRef: string): string | null {
  const [type, id] = entityRef.split(':');
  return type === 'forum_thread' && id ? id : null;
}

/**
 * Forum-thread synthesizer job handler (SPEC §5.7, M5-4.1). Runs the synthesis synchronously: fetch
 * the thread + its linked proposal + DAO, pick the model by length/contentiousness
 * (`chooseForumModel`), call the LLM, validate + persist. The cache key is `sha256(raw_content)`, so
 * a new post changes the hash and regenerates. Routing is deterministic in `raw_content`, so the
 * model-agnostic cache key never collides across models. Schema violations dead-letter (the client
 * retries once first); transient errors rethrow so the job retries.
 */
@Injectable()
export class ForumSynthesisHandler implements AiFeatureHandler, OnModuleInit {
  private readonly logger = new Logger('ForumSynthesisHandler');

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LLMClient,
    private readonly threads: ForumThreadReadRepository,
    private readonly assembler: ForumSynthesisAssembler,
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
    const id = parseThreadRef(job.entityRef);
    if (id === null) return;
    const thread = await this.threads.getThreadById(id);
    // SPEC §5.7: synthesize only linked threads that have content. The scan (#443) enforces the
    // linked + pending/active gate; guard defensively against a stale or mis-routed job here.
    if (thread === undefined || !thread.rawContent || thread.linkedProposalTitle === null) return;
    await this.synthesize(thread);
  }

  private async synthesize(thread: ForumThreadForSynthesis): Promise<void> {
    const { rendered, ctx, rawContent } = this.assembler.assemble(thread);
    const route = chooseForumModel(rawContent);
    const req: CompletionRequest<ForumSynthesis> = {
      feature: rendered.feature,
      promptVersion: rendered.promptVersion,
      model: route.model,
      schema: rendered.schema,
      messages: rendered.messages,
      mode: 'sync',
      inputContent: forumSynthesisInputContent(rawContent),
    };
    const inputHash = computeInputHash(req.inputContent);
    const existing = await this.outputs.find(req.feature, req.promptVersion, inputHash);
    if (existing !== undefined) {
      aiMetrics.cacheHitsTotal.add(1, { feature: FEATURE });
      return;
    }

    const start = Date.now();
    let result: CompletionResult<ForumSynthesis>;
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
    this.logger.log('ai_forum_synthesis_completed', {
      entityRef: ctx.entityReference,
      model: route.model,
      routing: route.reason,
    });
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
    this.logger.warn('ai_forum_synthesis_schema_violation', { entityRef: ctx.entityReference });
  }
}
