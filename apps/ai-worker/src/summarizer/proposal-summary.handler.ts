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
  type ProposalSummary,
} from '@libs/ai';
import { ProposalRepository } from '@libs/db';
import type { Proposal } from '@libs/db';
import { readPositiveInt } from '@libs/utils';
import { ProposalSummaryAssembler } from './proposal-summary.assembler';
import { AiBudgetState } from '../budget/ai-budget-state';
import type { AiFeatureHandler } from '../consumer/ai-feature-handler';
import { AiFeatureHandlerRegistry } from '../consumer/ai-feature-handler.registry';
import { LLM_CLIENT } from '../llm/llm.provider';
import { aiMetrics } from '../metrics/ai-metrics';
import type { AiJob } from '../queue/ai-queue-names';
import { AiTriggerConfig } from '../trigger/ai-trigger-config';

const FEATURE = 'proposal_summarizer';
// A proposal is "urgent" once it is `active` and its voting deadline is within this window, so it
// gets a synchronous summary instead of waiting for the batch cycle (SPEC §5.5). Default 6h.
const URGENT_WINDOW_MS = readPositiveInt('AI_SUMMARY_URGENT_WINDOW_MS', 6 * 60 * 60 * 1000);

function parseProposalRef(entityRef: string): string | null {
  const [type, id] = entityRef.split(':');
  return type === 'proposal' && id ? id : null;
}

function isUrgent(proposal: Proposal): boolean {
  if (proposal.state !== 'active' || proposal.voting_ends_at === null) return false;
  const remainingMs = proposal.voting_ends_at.getTime() - Date.now();
  return remainingMs > 0 && remainingMs <= URGENT_WINDOW_MS;
}

/**
 * Real-time summarizer job handler (SPEC §5.5, M5-2.2). The queue substrate (ADR-078) enqueues one
 * `ai_summarize` job per proposal entering `pending`/`active`. This handler runs the **synchronous
 * fallback**: for an `active` proposal whose voting deadline is imminent (and that isn't already
 * summarized) it produces the summary now rather than waiting for the batch cycle. Every other job
 * is acked and left to the in-process batch driver — the content-hash cache dedups across both.
 */
@Injectable()
export class ProposalSummaryHandler implements AiFeatureHandler, OnModuleInit {
  private readonly logger = new Logger('ProposalSummaryHandler');

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LLMClient,
    private readonly proposals: ProposalRepository,
    private readonly assembler: ProposalSummaryAssembler,
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
    if (proposal === undefined || !isUrgent(proposal)) return;
    await this.summarizeSync(proposal);
  }

  private async summarizeSync(proposal: Proposal): Promise<void> {
    const { rendered, ctx } = await this.assembler.assemble(proposal);
    const req: CompletionRequest<ProposalSummary> = {
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
    let result: CompletionResult<ProposalSummary>;
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
    this.logger.log('ai_summary_urgent_completed', { entityRef: ctx.entityReference });
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
    this.logger.warn('ai_summary_schema_violation', { entityRef: ctx.entityReference });
  }
}
