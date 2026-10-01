import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  AiCompletionCache,
  AiOutputRepository,
  chooseForumModel,
  completionRequestFromRendered,
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
import {
  buildForumSkip,
  FORUM_SKIP_PROFILE,
  ForumSynthesisAssembler,
} from './forum-synthesis.assembler';
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
 * Self-healing batch driver for forum-thread syntheses (SPEC §5.7). Batch is the default
 * cost-efficient path (0.5× pricing); the queue handler runs only the urgent/forced sync fallback. On
 * each tick: if idle, scan candidate threads (voting-phase + recently-closed) lacking a current
 * synthesis and submit one provider batch, routing each thread's tier by length/contentiousness and
 * skipping non-English threads inline. The open provider batch and its result descriptors live in
 * `ai_batch`, so a restart resumes polling instead of resubmitting.
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
    const english = isLikelyEnglish(rawContent);
    const route = chooseForumModel(rawContent);
    const req: CompletionRequest<ForumSynthesis> = completionRequestFromRendered(rendered, {
      mode: 'batch',
      inputContent,
      modelTier: route.modelTier,
      routingReason: route.reason,
    });
    const existing = await this.outputs.find(
      rendered.feature,
      rendered.promptVersion,
      inputHash,
      english ? req.generationProfileId : FORUM_SKIP_PROFILE,
    );
    if (existing !== undefined) {
      aiMetrics.cacheHitsTotal.add(1, { feature: FEATURE });
      return null;
    }
    if (!english) {
      const skip = buildForumSkip(rendered, inputContent, inputHash, this.clock.now());
      await this.cache.persist(skip.req, skip.result, ctx);
      return null;
    }
    return { item: { customId: toBatchCustomId(`forum_thread:${id}`), request: req }, ctx };
  }

  private async submit(): Promise<void> {
    const ids = await this.candidateIds();
    const batchItems: FacadeBatchItem<unknown>[] = [];
    const descriptors: BatchItemDescriptor[] = [];

    for (const id of ids) {
      const prepared = await this.prepareItem(id);
      if (prepared === null) continue;
      const item = {
        customId: prepared.item.customId,
        request: prepared.item.request as CompletionRequest<unknown>,
      };
      batchItems.push(item);
      descriptors.push(toDescriptor(item, prepared.ctx));
    }

    if (batchItems.length === 0) return;
    const handle = await this.llm.submitBatch(batchItems);
    await this.durable.record(FEATURE, handle, descriptors, null);
    this.logger.log('ai_forum_batch_submitted', { batchId: handle.id, count: batchItems.length });
  }
}
