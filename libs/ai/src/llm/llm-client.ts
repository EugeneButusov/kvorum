import { LlmSchemaViolationError } from './errors.js';
import type {
  BatchItem,
  BatchHandle,
  CompletionRequest,
  CompletionResult,
  CostUsd,
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
  FacadeBatchItem,
  LLMClient,
  LlmProvider,
  ProviderBatchResult,
  ProviderCompletionRequest,
} from './ports.js';
import { buildProvenance, computeInputHash, SystemClock, type Clock } from './provenance.js';
import { toStrippedJsonSchema } from './schema.js';

const MAX_ATTEMPTS = 2;

export interface CreateLlmClientOptions {
  provider: LlmProvider;
  embeddingProvider: EmbeddingProvider;
  clock?: Clock;
}

export class DefaultLlmClient implements LLMClient {
  private readonly provider: LlmProvider;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly clock: Clock;

  constructor(opts: CreateLlmClientOptions) {
    this.provider = opts.provider;
    this.embeddingProvider = opts.embeddingProvider;
    this.clock = opts.clock ?? new SystemClock();
  }

  async complete<T>(req: CompletionRequest<T>): Promise<CompletionResult<T>> {
    if (req.mode === 'batch') {
      throw new Error(
        'batch mode is orchestrated by the queue layer (#433); call submitBatch()/fetchBatch() instead of complete()',
      );
    }

    const inputHash = computeInputHash(req.inputContent);
    const providerReq = this.toProviderRequest(req);
    let accumulatedCost: CostUsd = {
      totalUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const providerRes = await this.provider.completeStructured(providerReq);
      accumulatedCost = addCosts(accumulatedCost, providerRes.cost);
      const parsed = req.schema.safeParse(providerRes.parsed);
      if (parsed.success) {
        return {
          output: parsed.data,
          cost: accumulatedCost,
          provenance: buildProvenance(req, inputHash, this.clock),
        };
      }
      if (attempt === MAX_ATTEMPTS) {
        // `parsed.error` is a ZodError in the failure branch; `providerRes.parsed` is the raw output.
        throw new LlmSchemaViolationError({
          feature: req.feature,
          promptVersion: req.promptVersion,
          inputHash,
          provider: req.provider,
          model: req.model,
          generationProfileId: req.generationProfileId,
          cost: accumulatedCost,
          rawOutput: providerRes.parsed,
          zodError: parsed.error,
          attempts: MAX_ATTEMPTS,
        });
      }
    }

    // Unreachable (the loop either returns or throws on the last attempt), but satisfies the
    // control-flow checker that the method always exits via return or throw.
    throw new Error('unreachable: complete() loop exited without result');
  }

  embed(req: EmbeddingRequest): Promise<EmbeddingResult> {
    return this.embeddingProvider.embed(req);
  }

  async submitBatch(items: FacadeBatchItem<unknown>[]): Promise<BatchHandle> {
    const providerItems: BatchItem[] = items.map((item) => ({
      customId: item.customId,
      request: this.toProviderRequest(item.request),
    }));
    if (this.provider.id !== 'openai') return this.provider.submitBatch(providerItems);

    const byModel = new Map<string, BatchItem[]>();
    for (const item of providerItems) {
      const group = byModel.get(item.request.model) ?? [];
      group.push(item);
      byModel.set(item.request.model, group);
    }
    const children = await Promise.all(
      [...byModel.values()].map((group) => this.provider.submitBatch(group)),
    );
    if (children.length === 1) return children[0]!;
    return {
      id: `composite:${children.map((child) => child.id).join(',')}`,
      provider: this.provider.id,
      children,
    };
  }

  async fetchBatch(handle: BatchHandle): Promise<ProviderBatchResult> {
    if (!handle.children || handle.children.length === 0) {
      return this.provider.fetchBatch(handle);
    }
    const childResults = await Promise.all(
      handle.children.map((child) => this.provider.fetchBatch(child)),
    );
    if (childResults.some((result) => result.status === 'in_progress')) {
      return { status: 'in_progress', results: [] };
    }
    return {
      status: 'ended',
      results: childResults.flatMap((result) => result.results),
    };
  }

  private toProviderRequest(req: CompletionRequest<unknown>): ProviderCompletionRequest {
    if (req.provider !== this.provider.id) {
      throw new Error(
        `Completion request profile uses provider "${req.provider}" but the active provider is "${this.provider.id}"`,
      );
    }
    return {
      model: req.model,
      system: req.system,
      messages: req.messages,
      jsonSchema: toStrippedJsonSchema(req.schema),
      mode: req.mode,
    };
  }
}

function addCosts(a: CostUsd, b: CostUsd): CostUsd {
  return {
    totalUsd: a.totalUsd + b.totalUsd,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

export function createLlmClient(opts: CreateLlmClientOptions): LLMClient {
  return new DefaultLlmClient(opts);
}
