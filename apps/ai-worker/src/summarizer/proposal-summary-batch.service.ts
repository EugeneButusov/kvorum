import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  AiCompletionCache,
  AiDlqRepository,
  AiOutputRepository,
  buildProvenance,
  computeInputHash,
  SystemClock,
  type BatchHandle,
  type Clock,
  type CompletionRequest,
  type CompletionResult,
  type CostContext,
  type CostUsd,
  type FacadeBatchItem,
  type LLMClient,
  type ProposalSummary,
} from '@libs/ai';
import { ProposalRepository } from '@libs/db';
import type { ProposalState } from '@libs/db';
import { readPositiveInt } from '@libs/utils';
import { ProposalSummaryAssembler } from './proposal-summary.assembler';
import { AiBudgetState } from '../budget/ai-budget-state';
import { LLM_CLIENT } from '../llm/llm.provider';
import { aiMetrics } from '../metrics/ai-metrics';
import { AiTriggerConfig } from '../trigger/ai-trigger-config';

const FEATURE = 'proposal_summarizer';
// SPEC §5.5: the summarizer targets proposals entering `pending`/`active`.
const SUMMARY_STATES: ProposalState[] = ['pending', 'active'];
const MAX_CANDIDATES = 100;
const BATCH_INTERVAL_MS = readPositiveInt('AI_SUMMARY_BATCH_MS', 5 * 60 * 1000);

interface PendingItem {
  req: CompletionRequest<ProposalSummary>;
  ctx: CostContext;
}
interface InFlightBatch {
  handle: BatchHandle;
  items: Map<string, PendingItem>;
}

/**
 * Self-healing, in-process batch driver for proposal summaries (SPEC §5.5). On each tick: if idle,
 * scan binding proposals lacking a current summary, submit one Anthropic batch; if a batch is in
 * flight, poll it and, once ended, validate + persist each result (or dead-letter it). Inert unless
 * the feature is enabled and its budget is not disabled. A restart drops in-flight state; the next
 * scan re-submits the un-summarized proposals (output is never wrong).
 */
@Injectable()
export class ProposalSummaryBatchService {
  private readonly logger = new Logger('ProposalSummaryBatch');
  private readonly clock: Clock = new SystemClock();
  private ticking = false;
  private inFlight: InFlightBatch | null = null;

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LLMClient,
    private readonly proposals: ProposalRepository,
    private readonly assembler: ProposalSummaryAssembler,
    private readonly outputs: AiOutputRepository,
    private readonly cache: AiCompletionCache,
    private readonly dlq: AiDlqRepository,
    private readonly config: AiTriggerConfig,
    private readonly budget: AiBudgetState,
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
      this.logger.warn('ai_summary_batch_failed', { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  private async submit(): Promise<void> {
    const candidates = await this.proposals.findBindingInStates(SUMMARY_STATES, MAX_CANDIDATES);
    const items = new Map<string, PendingItem>();
    const batchItems: FacadeBatchItem<unknown>[] = [];

    for (const proposal of candidates) {
      const { rendered, ctx } = await this.assembler.assemble(proposal);
      const req: CompletionRequest<ProposalSummary> = {
        feature: rendered.feature,
        promptVersion: rendered.promptVersion,
        model: rendered.model,
        schema: rendered.schema,
        messages: rendered.messages,
        mode: 'batch',
        inputContent: rendered.inputContent,
      };
      const inputHash = computeInputHash(req.inputContent);
      const existing = await this.outputs.find(req.feature, req.promptVersion, inputHash);
      if (existing !== undefined) {
        aiMetrics.cacheHitsTotal.add(1, { feature: FEATURE });
        continue;
      }
      const customId = `proposal:${proposal.id}`;
      items.set(customId, { req, ctx });
      batchItems.push({ customId, request: req as CompletionRequest<unknown> });
    }

    if (batchItems.length === 0) return;
    const handle = await this.llm.submitBatch(batchItems);
    this.inFlight = { handle, items };
    this.logger.log('ai_summary_batch_submitted', { batchId: handle.id, count: batchItems.length });
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
        this.logger.warn('ai_summary_result_failed', {
          customId: item.customId,
          error: String(err),
        });
      }
    }
    this.logger.log('ai_summary_batch_completed', {
      batchId: inFlight.handle.id,
      results: res.results.length,
    });
    this.inFlight = null;
  }

  private async processResult(
    req: CompletionRequest<ProposalSummary>,
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
      this.logger.warn('ai_summary_schema_violation', {
        feature: req.feature,
        entityRef: ctx.entityReference,
      });
      return;
    }
    const result: CompletionResult<ProposalSummary> = {
      output: validated.data,
      cost,
      provenance: buildProvenance(req, inputHash, this.clock),
    };
    await this.cache.persist(req, result, ctx);
    aiMetrics.tokensTotal.add(cost.inputTokens, { feature: FEATURE, kind: 'input' });
    aiMetrics.tokensTotal.add(cost.outputTokens, { feature: FEATURE, kind: 'output' });
  }
}
