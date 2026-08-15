import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  AiCompletionCache,
  AiCostLogRepository,
  AiDlqRepository,
  AiOutputRepository,
  chooseForumModel,
  computeInputHash,
  forumSynthesisInputContent,
  isLikelyEnglish,
  ProposalEmbeddingScanRepository,
  ProposalMismatchScanRepository,
  ProposalSummaryScanRepository,
  SystemClock,
  type BatchHandle,
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
import { processBackfillBatchResult } from './backfill-batch-result';
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

interface InFlightBatch {
  handle: BatchHandle;
  items: Map<string, { req: CompletionRequest<unknown>; ctx: CostContext }>;
  pendingCursor: string;
}
interface BatchState {
  cursor: string | null;
  inFlight: InFlightBatch | null;
}

/**
 * Full-history AI backfill driver (M5-7.1). On each tick it advances, per enabled feature, one unit of
 * work over the ENTIRE historical corpus — keyset-paginated so it never stalls on already-cached rows
 * (the flaw that makes the steady-state batch drivers unusable for backfill). Batch features
 * (summary/forum) submit to the Anthropic Batch API (0.5×) and poll/persist; sync features
 * (mismatch/embedding) enqueue to the existing pg-boss queues so the live handlers process them. Inert
 * unless `AI_BACKFILL_ENABLED` + the per-feature flag are set. Resumability is the content-hash cache
 * (unchanged input ⇒ cache hit ⇒ no call): a restart re-scans from the start and skips everything done.
 * The cursor is an in-memory progress optimization — final completeness is the AC #1 coverage query
 * plus a (cache-free) re-run, NOT the cursor, because a sync job enqueued just before the budget cap
 * trips is skipped at the worker yet the cursor advanced past it.
 */
@Injectable()
export class AiBackfillService {
  private readonly logger = new Logger('AiBackfill');
  private readonly clock: Clock = new SystemClock();
  private ticking = false;
  private readonly batchState = new Map<AiFeature, BatchState>();
  private readonly syncCursor = new Map<AiFeature, string | null>();

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
    private readonly dlq: AiDlqRepository,
    private readonly costs: AiCostLogRepository,
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

  // ── Batch features (summary, forum): submit the Batch API (0.5×), poll, persist, advance cursor ──

  private async driveBatch<Row extends { id: string }>(plan: BatchPlan<Row>): Promise<void> {
    const st = this.batchState.get(plan.feature) ?? { cursor: null, inFlight: null };
    // Always drain an in-flight batch — we already paid Anthropic for it — even if the cap just tripped.
    if (st.inFlight !== null) {
      const res = await this.llm.fetchBatch(st.inFlight.handle);
      if (res.status !== 'ended') return;
      for (const item of res.results) {
        const entry = st.inFlight.items.get(item.customId);
        if (entry === undefined) continue;
        try {
          await processBackfillBatchResult(entry.req, entry.ctx, item.parsed, item.cost, {
            cache: this.cache,
            dlq: this.dlq,
            costs: this.costs,
            clock: this.clock,
          });
        } catch (err) {
          this.logger.warn('ai_backfill_result_failed', {
            feature: plan.feature,
            customId: item.customId,
            error: String(err),
          });
        }
      }
      st.cursor = st.inFlight.pendingCursor;
      st.inFlight = null;
      this.batchState.set(plan.feature, st);
      return;
    }
    // Idle → submit the next page. Gate NEW submits on the budget (this is the "pause near cap").
    if (this.budget.isDisabled(plan.feature)) return;
    const rows = await plan.scanPage(st.cursor, this.config.pageSize(), this.config.daoSlugs());
    if (rows.length === 0) {
      this.batchState.set(plan.feature, st); // drained — nothing more to do
      return;
    }
    const pageCursor = rows[rows.length - 1]!.id;
    const items: FacadeBatchItem<unknown>[] = [];
    const pending = new Map<string, { req: CompletionRequest<unknown>; ctx: CostContext }>();
    for (const row of rows) {
      const built = await plan.buildItem(row);
      if (built === null) continue; // cache-hit / inline skip
      items.push(built.item);
      pending.set(built.item.customId, {
        req: built.item.request as CompletionRequest<unknown>,
        ctx: built.ctx,
      });
    }
    if (items.length === 0) {
      // Every row was already done — advance the cursor and continue next tick. THIS is the anti-stall
      // guarantee: unlike the steady-state driver, an all-cache-hit page never re-blocks progress.
      st.cursor = pageCursor;
      this.batchState.set(plan.feature, st);
      return;
    }
    const handle = await this.llm.submitBatch(items);
    st.inFlight = { handle, items: pending, pendingCursor: pageCursor };
    this.batchState.set(plan.feature, st);
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
        return { item: { customId: `proposal:${proposal.id}`, request: req }, ctx };
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
        return { item: { customId: `forum_thread:${id}`, request: req }, ctx };
      },
    };
  }

  // ── Sync features (mismatch, embedding): enqueue to the live queues, cursor-paginated over history ──

  private async driveSync(
    feature: AiFeature,
    scanPage: (
      cursor: string | null,
      pageSize: number,
      daoSlugs: string[],
    ) => Promise<{ id: string }[]>,
  ): Promise<void> {
    if (this.budget.isDisabled(feature)) return;
    const cursor = this.syncCursor.get(feature) ?? null;
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
    this.syncCursor.set(feature, rows[rows.length - 1]!.id);
    if (count > 0) this.logger.log('ai_backfill_enqueued', { feature, count });
  }
}
