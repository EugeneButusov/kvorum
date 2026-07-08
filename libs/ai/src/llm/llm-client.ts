import { LlmSchemaViolationError } from './errors.js';
import type {
  BatchItem,
  BatchHandle,
  CompletionRequest,
  CompletionResult,
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

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const providerRes = await this.provider.completeStructured(providerReq);
      const parsed = req.schema.safeParse(providerRes.parsed);
      if (parsed.success) {
        return {
          output: parsed.data,
          cost: providerRes.cost,
          provenance: buildProvenance(req, inputHash, this.clock),
        };
      }
      if (attempt === MAX_ATTEMPTS) {
        // `parsed.error` is a ZodError in the failure branch; `providerRes.parsed` is the raw output.
        throw new LlmSchemaViolationError({
          feature: req.feature,
          promptVersion: req.promptVersion,
          inputHash,
          model: req.model,
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

  submitBatch(items: FacadeBatchItem<unknown>[]): Promise<BatchHandle> {
    const providerItems: BatchItem[] = items.map((item) => ({
      customId: item.customId,
      request: this.toProviderRequest(item.request),
    }));
    return this.provider.submitBatch(providerItems);
  }

  fetchBatch(handle: BatchHandle): Promise<ProviderBatchResult> {
    return this.provider.fetchBatch(handle);
  }

  private toProviderRequest(req: CompletionRequest<unknown>): ProviderCompletionRequest {
    return {
      model: req.model,
      system: req.system,
      messages: req.messages,
      jsonSchema: toStrippedJsonSchema(req.schema),
      mode: req.mode,
    };
  }
}

export function createLlmClient(opts: CreateLlmClientOptions): LLMClient {
  return new DefaultLlmClient(opts);
}
