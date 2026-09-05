import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  AiCompletionCache,
  AiOutputRepository,
  chooseForumModel,
  computeInputHash,
  forumSynthesisInputContent,
  isLikelyEnglish,
  SystemClock,
  toBatchCustomId,
  type BatchItemDescriptor,
  type Clock,
  type CompletionRequest,
  type CostContext,
  type FacadeBatchItem,
  type ForumSynthesis,
  type LLMClient,
} from '@libs/ai';
import { readPositiveInt } from '@libs/utils';
import { ForumThreadReadRepository } from '@sources/forum';
import { buildForumSkip, ForumSynthesisAssembler } from './forum-synthesis.assembler';
import { DurableBatch, toDescriptor } from '../batch/durable-batch';
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

/**
 * Self-healing batch driver for forum-thread syntheses (SPEC §5.7). Batch is the default cost-efficient
 * path (0.5× pricing); the queue handler runs only the urgent/forced sync fallback. On each tick: poll
 * the durable in-flight batch (if any) and, once ended, persist each result; otherwise scan candidate
 * threads (voting-phase + recently-closed) lacking a current synthesis and submit one Anthropic batch,
 * routing each thread's model by length/contentiousness and persisting an inline skip for non-English
 * threads. Inert unless enabled and its budget is not disabled. The in-flight batch lives in `ai_batch`
 * (via {@link DurableBatch}), so a restart resumes it instead of orphaning the paid batch (#617).
 */
@Injectable()
export class ForumSynthesisBatchService {
  private readonly logger = new Logger('ForumSynthesisBatch');
  private readonly clock: Clock = new SystemClock();
  private ticking = false;

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LLMClient,
    private readonly threads: ForumThreadReadRepository,
    private readonly assembler: ForumSynthesisAssembler,
    private readonly outputs: AiOutputRepository,
    private readonly cache: AiCompletionCache,
    private readonly durable: DurableBatch,
    private readonly config: AiTriggerConfig,
    private readonly budget: AiBudgetState,
  ) {}

  @Interval(BATCH_INTERVAL_MS)
  async tick(): Promise<void> {
    if (this.ticking) return;
    if (!this.config.isEnabled(FEATURE) || this.budget.isDisabled(FEATURE)) return;
    this.ticking = true;
    try {
      const poll = await this.durable.pollOpen(FEATURE);
      if (poll.state === 'idle') {
        await this.submit();
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

  /** Build the batch item + cost context for one thread; persists an inline skip and returns null for
   *  a non-English or already-cached thread (nothing to submit). */
  private async prepareItem(
    id: string,
  ): Promise<{ item: FacadeBatchItem<unknown>; ctx: CostContext } | null> {
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
    return {
      item: {
        customId: toBatchCustomId(`forum_thread:${id}`),
        request: req as CompletionRequest<unknown>,
      },
      ctx,
    };
  }

  private async submit(): Promise<void> {
    const ids = await this.candidateIds();
    const batchItems: FacadeBatchItem<unknown>[] = [];
    const descriptors: BatchItemDescriptor[] = [];

    for (const id of ids) {
      const prepared = await this.prepareItem(id);
      if (prepared === null) continue;
      batchItems.push(prepared.item);
      descriptors.push(toDescriptor(prepared.item, prepared.ctx));
    }

    if (batchItems.length === 0) return;
    const handle = await this.llm.submitBatch(batchItems);
    await this.durable.record(FEATURE, handle, descriptors, null);
    this.logger.log('ai_forum_batch_submitted', { batchId: handle.id, count: batchItems.length });
  }
}
