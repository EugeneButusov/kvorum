import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  AiOutputRepository,
  completionRequestFromRendered,
  computeInputHash,
  ProposalSummaryScanRepository,
  toBatchCustomId,
  type BatchItemDescriptor,
  type CompletionRequest,
  type FacadeBatchItem,
  type LLMClient,
  type ProposalSummary,
} from '@libs/ai';
import type { ProposalState } from '@libs/db';
import { readPositiveInt } from '@libs/utils';
import { ProposalSummaryAssembler } from './proposal-summary.assembler';
import { DurableBatch, toDescriptor } from '../batch/durable-batch';
import { AiBudgetState } from '../budget/ai-budget-state';
import { LLM_CLIENT } from '../llm/llm.provider';
import { aiMetrics } from '../metrics/ai-metrics';
import { AiTriggerConfig } from '../trigger/ai-trigger-config';

const FEATURE = 'proposal_summarizer';
// SPEC §5.5: the summarizer targets proposals entering `pending`/`active`.
const SUMMARY_STATES: ProposalState[] = ['pending', 'active'];
const MAX_CANDIDATES = 100;
const BATCH_INTERVAL_MS = readPositiveInt('AI_SUMMARY_BATCH_MS', 5 * 60 * 1000);

/**
 * Self-healing batch driver for proposal summaries (SPEC §5.5). The open provider batch and its
 * result descriptors live in `ai_batch`, so a restart resumes polling instead of resubmitting.
 */
@Injectable()
export class ProposalSummaryBatchService {
  private readonly logger = new Logger('ProposalSummaryBatch');
  private ticking = false;

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LLMClient,
    private readonly scan: ProposalSummaryScanRepository,
    private readonly assembler: ProposalSummaryAssembler,
    private readonly outputs: AiOutputRepository,
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
      this.logger.warn('ai_summary_batch_failed', { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  private async submit(): Promise<void> {
    const candidates = await this.scan.findCandidates(SUMMARY_STATES, MAX_CANDIDATES);
    const batchItems: FacadeBatchItem<unknown>[] = [];
    const descriptors: BatchItemDescriptor[] = [];

    for (const proposal of candidates) {
      const { rendered, ctx } = await this.assembler.assemble(proposal);
      const req: CompletionRequest<ProposalSummary> = completionRequestFromRendered(rendered, {
        mode: 'batch',
      });
      const inputHash = computeInputHash(req.inputContent);
      const existing = await this.outputs.find(
        req.feature,
        req.promptVersion,
        inputHash,
        req.generationProfileId,
      );
      if (existing !== undefined) {
        aiMetrics.cacheHitsTotal.add(1, { feature: FEATURE });
        continue;
      }
      const customId = toBatchCustomId(`proposal:${proposal.id}`);
      const item = { customId, request: req as CompletionRequest<unknown> };
      batchItems.push(item);
      descriptors.push(toDescriptor(item, ctx));
    }

    if (batchItems.length === 0) return;
    const handle = await this.llm.submitBatch(batchItems);
    await this.durable.record(FEATURE, handle, descriptors, null);
    this.logger.log('ai_summary_batch_submitted', { batchId: handle.id, count: batchItems.length });
  }
}
