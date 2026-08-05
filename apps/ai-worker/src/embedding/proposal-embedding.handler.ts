import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  computeInputHash,
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
  proposalEmbeddingInputContent,
  ProposalEmbeddingCache,
  ProposalEmbeddingRepository,
  type LLMClient,
} from '@libs/ai';
import { ProposalReadRepository, ProposalRepository } from '@libs/db';
import type { Proposal } from '@libs/db';
import { AiBudgetState } from '../budget/ai-budget-state';
import type { AiFeatureHandler } from '../consumer/ai-feature-handler';
import { AiFeatureHandlerRegistry } from '../consumer/ai-feature-handler.registry';
import { LLM_CLIENT } from '../llm/llm.provider';
import { aiMetrics } from '../metrics/ai-metrics';
import type { AiJob } from '../queue/ai-queue-names';
import { AiTriggerConfig } from '../trigger/ai-trigger-config';

const FEATURE = 'embedding';

function parseProposalRef(entityRef: string): string | null {
  const [type, id] = entityRef.split(':');
  return type === 'proposal' && id ? id : null;
}

/**
 * Proposal-embedding job handler (SPEC §5.8, M5-5.2). For a proposal that has entered any state above
 * `pending`, composes the deterministic input (title + description + one-line action summary,
 * ADR-081), embeds it with `text-embedding-3-small`, and upserts the 1536-dim vector into
 * `proposal_embedding` — unless the composed input is unchanged (cache-hit by `input_hash`, no API
 * call). There is no structured-output schema or DLQ path: an `embed()` error propagates so the job
 * retries and eventually lands in `ai_embed_dlq`.
 */
@Injectable()
export class ProposalEmbeddingHandler implements AiFeatureHandler, OnModuleInit {
  private readonly logger = new Logger('ProposalEmbeddingHandler');

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LLMClient,
    private readonly proposals: ProposalRepository,
    private readonly reads: ProposalReadRepository,
    private readonly embeddings: ProposalEmbeddingRepository,
    private readonly cache: ProposalEmbeddingCache,
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
    if (proposal === undefined) return;
    await this.embed(id, proposal);
  }

  private async embed(id: string, proposal: Proposal): Promise<void> {
    const actions = await this.reads.findActions(id);
    const inputContent = proposalEmbeddingInputContent(
      proposal.title,
      proposal.description,
      actions,
    );
    const inputHash = computeInputHash(inputContent);

    const existing = await this.embeddings.findByProposalVersion(id, EMBEDDING_VERSION);
    if (existing?.input_hash === inputHash) {
      aiMetrics.cacheHitsTotal.add(1, { feature: FEATURE });
      return;
    }

    const start = Date.now();
    // No try/catch: a transient/API error propagates so the job retries → ai_embed_dlq.
    const result = await this.llm.embed({ model: EMBEDDING_MODEL, input: inputContent });
    await this.cache.persist(
      {
        proposalId: id,
        embeddingVersion: EMBEDDING_VERSION,
        inputHash,
        vector: `[${result.vector.join(',')}]`,
        model: EMBEDDING_MODEL,
        inputTokens: result.cost.inputTokens,
        costUsd: result.cost.totalUsd,
      },
      { daoId: proposal.dao_id, entityReference: `proposal:${id}` },
    );
    aiMetrics.latencySeconds.record((Date.now() - start) / 1000, { feature: FEATURE });
    aiMetrics.tokensTotal.add(result.cost.inputTokens, { feature: FEATURE, kind: 'input' });
    this.logger.log('ai_embedding_completed', { entityRef: `proposal:${id}` });
  }
}
