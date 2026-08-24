import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  AiCompletionCache,
  AiOutputRepository,
  chooseForumModel,
  computeInputHash,
  forumSynthesisInputContent,
  isLikelyEnglish,
  ProposalEmbeddingScanRepository,
  ProposalMismatchScanRepository,
  ProposalSummaryScanRepository,
  SystemClock,
  toBatchCustomId,
  type BatchItemDescriptor,
  type Clock,
  type CompletionRequest,
  type CostContext,
  type FacadeBatchItem,
  type LLMClient,
} from '@libs/ai';
import type { Proposal } from '@libs/db';
import { readPositiveInt } from '@libs/utils';
import { ForumThreadReadRepository } from '@sources/forum';
import { AiBackfillConfig } from './ai-backfill-config';
import { DurableBatch, toDescriptor } from '../batch/durable-batch';
import { AiBudgetState } from '../budget/ai-budget-state';
import { buildForumSkip, ForumSynthesisAssembler } from '../forum/forum-synthesis.assembler';
import { LLM_CLIENT } from '../llm/llm.provider';
import { aiMetrics } from '../metrics/ai-metrics';
import { AiJob, type AiFeature, FEATURE_QUEUE } from '../queue/ai-queue-names';
import { AI_QUEUE_PORT, type AiQueuePort } from '../queue/ai-queue.port';
import { ProposalSummaryAssembler } from '../summarizer/proposal-summary.assembler';

const TICK_MS = readPositiveInt('AI_BACKFILL_TICK_MS', 5 * 60 * 1000);
const DEFAULT_SINGLETON_THROTTLE_SECONDS = 3600;

interface PreparedItem {
  item: FacadeBatchItem<unknown>;
  ctx: CostContext;
}

/** A batch-feature drain: how to page full history and turn a row into a batch item (null = skip). */
interface BatchPlan<Row extends { id: string }> {
  feature: AiFeature;
  scanPage(cursor: string | null, pageSize: number, daoSlugs: string[]): Promise<Row[]>;
  buildItem(row: Row): Promise<PreparedItem | null>;
}

/**
 * Full-history AI backfill driver (M5-7.1). On each tick it advances, per enabled feature, one unit of
 * work over the ENTIRE historical corpus — keyset-paginated so it never stalls on already-cached rows.
 * Batch features (summary/forum) submit to the Anthropic Batch API (0.5×) and poll/persist via the
 * durable {@link DurableBatch} gateway; sync features (mismatch/embedding) enqueue to the pg-boss
 * queues. Both the in-flight batch (`ai_batch`) and the walk cursor (`ai_backfill_cursor`) are durable,
 * so a restart resumes the batch and the walk instead of orphaning a paid batch or re-scanning from the
 * start (#617). Inert unless `AI_BACKFILL_ENABLED` + the per-feature flag are set.
 */
@Injectable()
export class AiBackfillService {
  private readonly logger = new Logger('AiBackfill');
  private readonly clock: Clock = new SystemClock();
  private ticking = false;

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LLMClient,
    @Inject(AI_QUEUE_PORT) private readonly queue: AiQueuePort,
    private readonly summaryScan: ProposalSummaryScanRepository,
    private readonly mismatchScan: ProposalMismatchScanRepository,
    private readonly embeddingScan: ProposalEmbeddingScanRepository,
    private readonly forumThreads: ForumThreadReadRepository,
    private readonly summaryAssembler: ProposalSummaryAssembler,
    private readonly forumAssembler: ForumSynthesisAssembler,
    private readonly outputs: AiOutputRepository,
    private readonly cache: AiCompletionCache,
    private readonly durable: DurableBatch,
    private readonly budget: AiBudgetState,
    private readonly config: AiBackfillConfig,
  ) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    if (this.ticking) return;
    if (!this.config.isEnabled()) return;
    this.ticking = true;
    try {
      if (this.config.isFeatureEnabled('proposal_summarizer')) {
        await this.driveBatch(this.summaryPlan());
      }
      if (this.config.isFeatureEnabled('forum_synthesizer')) {
        await this.driveBatch(this.forumPlan());
      }
      if (this.config.isFeatureEnabled('mismatch_detector')) {
        await this.driveSync('mismatch_detector', (c, p, d) =>
          this.mismatchScan.findAllForBackfill(c, p, d),
        );
      }
      if (this.config.isFeatureEnabled('embedding')) {
        await this.driveSync('embedding', (c, p, d) =>
          this.embeddingScan.findAllForBackfill(c, p, d),
        );
      }
    } catch (err) {
      this.logger.warn('ai_backfill_tick_failed', { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  // ── Batch features (summary, forum): submit the Batch API (0.5×), poll+persist, advance cursor ──

  private async driveBatch<Row extends { id: string }>(plan: BatchPlan<Row>): Promise<void> {
    // Poll/drain the durable in-flight batch first (the drain persists results + commits the cursor).
    const poll = await this.durable.pollOpen(plan.feature);
    if (poll.state !== 'idle') return; // waiting, or just drained → scan the next page next tick

    // Idle → submit the next page. Gate NEW submits on the budget (this is the "pause near cap").
    if (this.budget.isDisabled(plan.feature)) return;
    const cursor = await this.durable.getCursor(plan.feature);
    const rows = await plan.scanPage(cursor, this.config.pageSize(), this.config.daoSlugs());
    if (rows.length === 0) return; // drained — nothing more to do

    const pageCursor = rows[rows.length - 1]!.id;
    const items: FacadeBatchItem<unknown>[] = [];
    const descriptors: BatchItemDescriptor[] = [];
    for (const row of rows) {
      const built = await plan.buildItem(row);
      if (built === null) continue; // cache-hit / inline skip
      items.push(built.item);
      descriptors.push(toDescriptor(built.item, built.ctx));
    }
    if (items.length === 0) {
      // Every row was already done — advance the durable cursor and continue next tick. THIS is the
      // anti-stall guarantee: an all-cache-hit page never re-blocks progress.
      await this.durable.advanceCursor(plan.feature, pageCursor);
      return;
    }
    const handle = await this.llm.submitBatch(items);
    await this.durable.record(plan.feature, handle, descriptors, pageCursor);
    this.logger.log('ai_backfill_batch_submitted', {
      feature: plan.feature,
      batchId: handle.id,
      count: items.length,
    });
  }

  private summaryPlan(): BatchPlan<Proposal> {
    return {
      feature: 'proposal_summarizer',
      scanPage: (c, p, d) => this.summaryScan.findAllForBackfill(c, p, d),
      buildItem: async (proposal) => {
        const { rendered, ctx } = await this.summaryAssembler.assemble(proposal);
        const req: CompletionRequest<unknown> = {
          feature: rendered.feature,
          promptVersion: rendered.promptVersion,
          model: rendered.model,
          schema: rendered.schema,
          messages: rendered.messages,
          mode: 'batch',
          inputContent: rendered.inputContent,
        };
        const inputHash = computeInputHash(req.inputContent);
        if ((await this.outputs.find(req.feature, req.promptVersion, inputHash)) !== undefined) {
          aiMetrics.cacheHitsTotal.add(1, { feature: 'proposal_summarizer' });
          return null;
        }
        return {
          item: { customId: toBatchCustomId(`proposal:${proposal.id}`), request: req },
          ctx,
        };
      },
    };
  }

  private forumPlan(): BatchPlan<{ id: string }> {
    return {
      feature: 'forum_synthesizer',
      scanPage: (c, p, d) => this.forumThreads.findAllForBackfill(c, p, d),
      buildItem: async ({ id }) => {
        const thread = await this.forumThreads.getThreadById(id);
        if (thread === undefined || !thread.rawContent || thread.linkedProposalTitle === null) {
          return null;
        }
        const { rendered, ctx, rawContent } = this.forumAssembler.assemble(thread);
        const inputContent = forumSynthesisInputContent(rawContent);
        const inputHash = computeInputHash(inputContent);
        if (
          (await this.outputs.find(rendered.feature, rendered.promptVersion, inputHash)) !==
          undefined
        ) {
          aiMetrics.cacheHitsTotal.add(1, { feature: 'forum_synthesizer' });
          return null;
        }
        if (!isLikelyEnglish(rawContent)) {
          const skip = buildForumSkip(rendered, inputContent, inputHash, this.clock.now());
          await this.cache.persist(skip.req, skip.result, ctx);
          return null;
        }
        const route = chooseForumModel(rawContent);
        const req: CompletionRequest<unknown> = {
          feature: rendered.feature,
          promptVersion: rendered.promptVersion,
          model: route.model,
          schema: rendered.schema,
          messages: rendered.messages,
          mode: 'batch',
          inputContent,
          routingReason: route.reason,
        };
        return { item: { customId: toBatchCustomId(`forum_thread:${id}`), request: req }, ctx };
      },
    };
  }

  // ── Sync features (mismatch, embedding): enqueue to the live queues, durable-cursor-paginated ──

  private async driveSync(
    feature: AiFeature,
    scanPage: (
      cursor: string | null,
      pageSize: number,
      daoSlugs: string[],
    ) => Promise<{ id: string }[]>,
  ): Promise<void> {
    if (this.budget.isDisabled(feature)) return;
    const cursor = await this.durable.getCursor(feature);
    const rows = await scanPage(cursor, this.config.pageSize(), this.config.daoSlugs());
    if (rows.length === 0) return; // drained
    const throttle = readPositiveInt(
      'AI_SINGLETON_THROTTLE_SECONDS',
      DEFAULT_SINGLETON_THROTTLE_SECONDS,
    );
    let count = 0;
    for (const row of rows) {
      const entityRef = `proposal:${row.id}`;
      const job: AiJob = { feature, entityRef };
      const id = await this.queue.send(FEATURE_QUEUE[feature].main, job, {
        singletonKey: `${feature}:${entityRef}`,
        singletonSeconds: throttle,
      });
      if (id !== null) count += 1;
    }
    await this.durable.advanceCursor(feature, rows[rows.length - 1]!.id);
    if (count > 0) this.logger.log('ai_backfill_enqueued', { feature, count });
  }
}
