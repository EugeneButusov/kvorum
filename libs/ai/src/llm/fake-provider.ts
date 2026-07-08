import type {
  BatchHandle,
  BatchItem,
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
  LlmProvider,
  ProviderBatchResult,
  ProviderCompletionRequest,
  ProviderCompletionResult,
} from './ports.js';

const ZERO_COST = { totalUsd: 0, inputTokens: 0, outputTokens: 0 };

/** A scripted LlmProvider: returns queued `parsed` payloads in order. */
export class FakeLlmProvider implements LlmProvider {
  readonly id = 'fake';
  private readonly queue: unknown[];
  public calls: ProviderCompletionRequest[] = [];

  constructor(queue: unknown[]) {
    this.queue = [...queue];
  }

  completeStructured(req: ProviderCompletionRequest): Promise<ProviderCompletionResult> {
    this.calls.push(req);
    const parsed = this.queue.length > 0 ? this.queue.shift() : undefined;
    return Promise.resolve({ parsed, cost: { ...ZERO_COST } });
  }

  submitBatch(items: BatchItem[]): Promise<BatchHandle> {
    return Promise.resolve({ id: `fake-batch-${items.length}`, provider: this.id });
  }

  fetchBatch(_handle: BatchHandle): Promise<ProviderBatchResult> {
    return Promise.resolve({ status: 'ended', results: [] });
  }
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'fake-embed';
  embed(req: EmbeddingRequest): Promise<EmbeddingResult> {
    return Promise.resolve({ vector: [0.1, 0.2, 0.3], cost: { ...ZERO_COST }, model: req.model });
  }
}
