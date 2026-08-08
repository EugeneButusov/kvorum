import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  AiCompletionCache,
  AiCostLogRepository,
  AiDlqRepository,
  AiOutputRepository,
  buildProvenance,
  chooseForumModel,
  computeInputHash,
  forumSynthesisInputContent,
  isLikelyEnglish,
  SystemClock,
  type BatchHandle,
  type Clock,
  type CompletionRequest,
  type CompletionResult,
  type CostContext,
  type CostUsd,
  type FacadeBatchItem,
  type ForumSynthesis,
  type LLMClient,
} from '@libs/ai';
import { readPositiveInt } from '@libs/utils';
import { ForumThreadReadRepository } from '@sources/forum';
import { buildForumSkip, ForumSynthesisAssembler } from './forum-synthesis.assembler';
import { AiBudgetState } from '../budget/ai-budget-state';
import { LLM_CLIENT } from '../llm/llm.provider';
import { aiMetrics } from '../metrics/ai-metrics';
import { AiTriggerConfig } from '../trigger/ai-trigger-config';
import {
  CLOSED_FORUM_STATES,
  DEFAULT_FORUM_CLOSE_GRACE_MS,
  FORUM_STATES,
} from '../trigger/ai-trigger-scanner';

const FEATURE = 'forum_synthesizer';
const MAX_CANDIDATES = 100;
const BATCH_INTERVAL_MS = readPositiveInt('AI_FORUM_BATCH_MS', 5 * 60 * 1000);

interface PendingItem {
  req: CompletionRequest<ForumSynthesis>;
  ctx: CostContext;
}
interface InFlightBatch {
  handle: BatchHandle;
  items: Map<string, PendingItem>;
}

/**
 * Self-healing, in-process batch driver for forum-thread syntheses (SPEC §5.7). Batch is the default
 * cost-efficient path (0.5× pricing); the queue handler runs only the urgent/forced sync fallback. On
 * each tick: if idle, scan candidate threads (voting-phase + recently-closed) lacking a current
 * synthesis and submit one Anthropic batch, routing each thread's model by length/contentiousness and
 * skipping non-English threads inline; if a batch is in flight, poll it and, once ended, validate +
 * persist each result (or dead-letter it). Inert unless the feature is enabled and its budget is not
 * disabled. A restart drops in-flight state; the next scan re-submits (the sha256(raw_content) cache
 * makes it idempotent, and dedups against the sync handler).
 */
@Injectable()
export class ForumSynthesisBatchService {
  private readonly logger = new Logger('ForumSynthesisBatch');
  private readonly clock: Clock = new SystemClock();
  private ticking = false;
  private inFlight: InFlightBatch | null = null;

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LLMClient,
    private readonly threads: ForumThreadReadRepository,
    private readonly assembler: ForumSynthesisAssembler,
    private readonly outputs: AiOutputRepository,
    private readonly cache: AiCompletionCache,
    private readonly dlq: AiDlqRepository,
    private readonly config: AiTriggerConfig,
    private readonly budget: AiBudgetState,
    private readonly costs: AiCostLogRepository,
  ) {}

  @Interval(BATCH_INTERVAL_MS)
  async tick(): Promise<void> {
    if (this.ticking) return;
    if (!this.config.isEnabled(FEATURE) || this.budget.isDisabled(FEATURE)) return;
    this.ticking = true;
    try {
      if (this.inFlight === null) {
        await this.submit();
      } else {
        await this.poll();
      }
    } catch (err) {
      this.logger.warn('ai_forum_batch_failed', { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  /** The union of voting-phase and recently-closed candidate thread ids (SPEC §5.7), deduped. */
  private async candidateIds(): Promise<string[]> {
    const graceMs = readPositiveInt('AI_FORUM_CLOSE_GRACE_MS', DEFAULT_FORUM_CLOSE_GRACE_MS);
    const [active, closed] = await Promise.all([
      this.threads.findSynthesisCandidates(FORUM_STATES, MAX_CANDIDATES),
      this.threads.findRecentlyClosedSynthesisCandidates(
        CLOSED_FORUM_STATES,
        new Date(Date.now() - graceMs),
        MAX_CANDIDATES,
      ),
    ]);
    return [...new Set([...active, ...closed].map((row) => row.id))];
  }

  /** Build the batch request + cost context for one thread; persists an inline skip and returns null
   *  for a non-English or already-cached thread (nothing to submit). */
  private async prepareItem(
    id: string,
  ): Promise<{ item: FacadeBatchItem<ForumSynthesis>; ctx: CostContext } | null> {
    const thread = await this.threads.getThreadById(id);
    if (thread === undefined || !thread.rawContent || thread.linkedProposalTitle === null) {
      return null;
    }
    const { rendered, ctx, rawContent } = this.assembler.assemble(thread);
    const inputContent = forumSynthesisInputContent(rawContent);
    const inputHash = computeInputHash(inputContent);
    const existing = await this.outputs.find(rendered.feature, rendered.promptVersion, inputHash);
    if (existing !== undefined) {
      aiMetrics.cacheHitsTotal.add(1, { feature: FEATURE });
      return null;
    }
    if (!isLikelyEnglish(rawContent)) {
      const skip = buildForumSkip(rendered, inputContent, inputHash, this.clock.now());
      await this.cache.persist(skip.req, skip.result, ctx);
      return null;
    }
    const route = chooseForumModel(rawContent);
    const req: CompletionRequest<ForumSynthesis> = {
      feature: rendered.feature,
      promptVersion: rendered.promptVersion,
      model: route.model,
      schema: rendered.schema,
      messages: rendered.messages,
      mode: 'batch',
      inputContent,
      routingReason: route.reason,
    };
    return { item: { customId: `forum_thread:${id}`, request: req }, ctx };
  }

  private async submit(): Promise<void> {
    const ids = await this.candidateIds();
    const items = new Map<string, PendingItem>();
    const batchItems: FacadeBatchItem<unknown>[] = [];

    for (const id of ids) {
      const prepared = await this.prepareItem(id);
      if (prepared === null) continue;
      items.set(prepared.item.customId, { req: prepared.item.request, ctx: prepared.ctx });
      batchItems.push({
        customId: prepared.item.customId,
        request: prepared.item.request as CompletionRequest<unknown>,
      });
    }

    if (batchItems.length === 0) return;
    const handle = await this.llm.submitBatch(batchItems);
    this.inFlight = { handle, items };
    this.logger.log('ai_forum_batch_submitted', { batchId: handle.id, count: batchItems.length });
  }

  private async poll(): Promise<void> {
    const inFlight = this.inFlight;
    if (inFlight === null) return;
    const res = await this.llm.fetchBatch(inFlight.handle);
    if (res.status !== 'ended') return;
    for (const item of res.results) {
      const entry = inFlight.items.get(item.customId);
      if (entry === undefined) continue;
      try {
        await this.processResult(entry.req, entry.ctx, item.parsed, item.cost);
      } catch (err) {
        this.logger.warn('ai_forum_result_failed', { customId: item.customId, error: String(err) });
      }
    }
    this.logger.log('ai_forum_batch_completed', {
      batchId: inFlight.handle.id,
      results: res.results.length,
    });
    this.inFlight = null;
  }

  private async processResult(
    req: CompletionRequest<ForumSynthesis>,
    ctx: CostContext,
    parsed: unknown,
    cost: CostUsd,
  ): Promise<void> {
    const inputHash = computeInputHash(req.inputContent);
    const validated = req.schema.safeParse(parsed);
    if (!validated.success) {
      const now = new Date();
      await this.dlq.insert({
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
      await this.costs.insert({
        timestamp: now,
        feature_name: req.feature,
        model: req.model,
        input_tokens: cost.inputTokens,
        output_tokens: cost.outputTokens,
        cost_usd: String(cost.totalUsd),
        dao_id: ctx.daoId,
        entity_reference: ctx.entityReference,
      });
      this.logger.warn('ai_forum_schema_violation', {
        feature: req.feature,
        entityRef: ctx.entityReference,
      });
      return;
    }
    const result: CompletionResult<ForumSynthesis> = {
      output: validated.data,
      cost,
      provenance: buildProvenance(req, inputHash, this.clock),
    };
    await this.cache.persist(req, result, ctx);
    aiMetrics.tokensTotal.add(cost.inputTokens, { feature: FEATURE, kind: 'input' });
    aiMetrics.tokensTotal.add(cost.outputTokens, { feature: FEATURE, kind: 'output' });
  }
}
