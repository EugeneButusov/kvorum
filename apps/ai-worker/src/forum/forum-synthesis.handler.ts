import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AiCompletionCache,
  AiCostLogRepository,
  AiDlqRepository,
  AiOutputRepository,
  chooseForumModel,
  completionRequestFromRendered,
  computeInputHash,
  forumSynthesisInputContent,
  isLikelyEnglish,
  LlmSchemaViolationError,
  type CompletionRequest,
  type CompletionResult,
  type CostContext,
  type ForumSynthesis,
  type LLMClient,
  type RenderedPrompt,
} from '@libs/ai';
import { readPositiveInt } from '@libs/utils';
import { ForumThreadReadRepository, type ForumThreadForSynthesis } from '@sources/forum';
import {
  buildForumSkip,
  FORUM_SKIP_PROFILE,
  ForumSynthesisAssembler,
} from './forum-synthesis.assembler';
import { AiBudgetState } from '../budget/ai-budget-state';
import type { AiFeatureHandler } from '../consumer/ai-feature-handler';
import { AiFeatureHandlerRegistry } from '../consumer/ai-feature-handler.registry';
import { LLM_CLIENT } from '../llm/llm.provider';
import { aiMetrics } from '../metrics/ai-metrics';
import type { AiJob } from '../queue/ai-queue-names';
import { AiTriggerConfig } from '../trigger/ai-trigger-config';

const FEATURE = 'forum_synthesizer';
// A thread is "urgent" when its highest-confidence linked proposal is `active` with voting ending
// within this window — it gets a synchronous synthesis now rather than waiting for the batch cycle
// (SPEC §5.7). Every non-urgent thread is left to the in-process batch driver. Default 6h.
const URGENT_WINDOW_MS = readPositiveInt('AI_FORUM_URGENT_WINDOW_MS', 6 * 60 * 60 * 1000);

function parseThreadRef(entityRef: string): string | null {
  const [type, id] = entityRef.split(':');
  return type === 'forum_thread' && id ? id : null;
}

function isThreadUrgent(thread: ForumThreadForSynthesis): boolean {
  if (thread.linkedProposalState !== 'active' || thread.linkedProposalVotingEndsAt === null) {
    return false;
  }
  const remainingMs = thread.linkedProposalVotingEndsAt.getTime() - Date.now();
  return remainingMs > 0 && remainingMs <= URGENT_WINDOW_MS;
}

/**
 * Forum-thread synthesizer job handler (SPEC §5.7). Runs the **synchronous fallback**: batch is the
 * default (the in-process batch driver does the bulk at 0.5× cost), so this handler synthesizes now
 * only when the job is an operator-forced refresh or the thread's linked proposal has imminent voting;
 * every other job is acked and left to the batch driver — the `sha256(raw_content)` cache dedups
 * across both. When it does run: pick the model by length/contentiousness (`chooseForumModel`), call
 * the LLM, validate + persist. A new post changes the hash and regenerates. Schema violations
 * dead-letter (the client retries once first); transient errors rethrow so the job retries.
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
    private readonly costs: AiCostLogRepository,
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
    // The scan enforces the linked + state gate; guard defensively against a stale/mis-routed job.
    // Synthesize only linked threads that have content.
    if (thread === undefined || !thread.rawContent || thread.linkedProposalTitle === null) return;
    // Batch by default (SPEC §5.7): run now only for an operator-forced refresh or a thread whose
    // linked proposal's voting is imminent; otherwise ack and let the batch driver handle it.
    const force = job.force === true;
    if (!force && !isThreadUrgent(thread)) return;
    await this.synthesize(thread, force);
  }

  private async synthesize(thread: ForumThreadForSynthesis, force: boolean): Promise<void> {
    const { rendered, ctx, rawContent } = this.assembler.assemble(thread);
    const inputContent = forumSynthesisInputContent(rawContent);
    const inputHash = computeInputHash(inputContent);
    const english = isLikelyEnglish(rawContent);
    const route = chooseForumModel(rawContent);
    const req: CompletionRequest<ForumSynthesis> = completionRequestFromRendered(rendered, {
      mode: 'sync',
      inputContent,
      modelTier: route.modelTier,
      routingReason: route.reason,
    });
    const cacheProfileId = english ? req.generationProfileId : FORUM_SKIP_PROFILE;
    if (force) {
      // Operator-forced refresh: clear the immutable-append cache (incl. any skip marker) so the
      // re-run overwrites it rather than no-opping on the unique-key conflict.
      await this.outputs.deleteByKey(
        rendered.feature,
        rendered.promptVersion,
        inputHash,
        cacheProfileId,
      );
    } else {
      const existing = await this.outputs.find(
        rendered.feature,
        rendered.promptVersion,
        inputHash,
        cacheProfileId,
      );
      if (existing !== undefined) {
        aiMetrics.cacheHitsTotal.add(1, { feature: FEATURE });
        return;
      }
    }

    // SPEC §5.7 / KNOWN-016: v1 synthesizes English threads only. A non-English thread is skipped —
    // persist a sentinel `ai_output` row (no LLM call, zero cost) keyed on the same
    // `sha256(raw_content)`, so the API surfaces the reason and the scan won't re-spend on it.
    if (!english) {
      await this.persistSkip(rendered, ctx, inputContent, inputHash);
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
      model: req.model,
      routing: route.reason,
    });
  }

  private async persistSkip(
    rendered: RenderedPrompt<ForumSynthesis>,
    ctx: CostContext,
    inputContent: string,
    inputHash: string,
  ): Promise<void> {
    const { req, result } = buildForumSkip(
      rendered,
      inputContent,
      inputHash,
      new Date().toISOString(),
    );
    await this.cache.persist(req, result, ctx);
    this.logger.log('ai_forum_synthesis_skipped', {
      entityRef: ctx.entityReference,
      reason: 'non_english',
    });
  }

  private async deadLetter(err: LlmSchemaViolationError, ctx: CostContext): Promise<void> {
    const now = new Date();
    await this.dlq.insert({
      feature_name: err.feature,
      prompt_version: err.promptVersion,
      input_hash: err.inputHash,
      provider: err.provider,
      model: err.model,
      generation_profile_id: err.generationProfileId,
      raw_output: err.rawOutput as never,
      zod_error: err.zodError as never,
      attempts: err.attempts,
      first_seen_at: now,
      last_seen_at: now,
    });
    await this.costs.insert({
      timestamp: now,
      feature_name: err.feature,
      provider: err.provider,
      model: err.model,
      generation_profile_id: err.generationProfileId,
      input_tokens: err.cost.inputTokens,
      output_tokens: err.cost.outputTokens,
      cache_creation_input_tokens: err.cost.cacheCreationInputTokens,
      cache_read_input_tokens: err.cost.cacheReadInputTokens,
      cost_usd: String(err.cost.totalUsd),
      dao_id: ctx.daoId,
      entity_reference: ctx.entityReference,
    });
    this.logger.warn('ai_forum_synthesis_schema_violation', { entityRef: ctx.entityReference });
  }
}
