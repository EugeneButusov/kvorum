import type { ZodType } from 'zod';

export type LlmRole = 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export type CompletionMode = 'sync' | 'batch';

export interface CostUsd {
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface Provenance {
  feature: string;
  model: string;
  promptVersion: string;
  inputHash: string; // 'sha256:<hex>'
  generatedAt: string; // ISO-8601
}

export interface CompletionRequest<T> {
  feature: string;
  promptVersion: string;
  model: string;
  schema: ZodType<T>;
  system?: string;
  messages: LlmMessage[];
  mode: CompletionMode;
  inputContent: string; // canonical string hashed for provenance / cache key
}

export interface CompletionResult<T> {
  output: T;
  cost: CostUsd;
  provenance: Provenance;
}

export interface EmbeddingRequest {
  model: string;
  input: string;
}

export interface EmbeddingResult {
  vector: number[];
  cost: CostUsd;
  model: string;
}

// ---- Provider-facing (neutral) contracts ----

export type JsonSchema = Record<string, unknown>;

export interface ProviderCompletionRequest {
  model: string;
  system?: string;
  messages: LlmMessage[];
  jsonSchema: JsonSchema; // already stripped of unsupported keywords by the facade
  mode: CompletionMode;
}

export interface ProviderCompletionResult {
  parsed: unknown; // parsed JSON object, NOT yet Zod-validated
  cost: CostUsd;
}

export interface BatchItem {
  customId: string;
  request: ProviderCompletionRequest;
}

export interface BatchHandle {
  id: string;
  provider: string;
}

export interface ProviderBatchItemResult {
  customId: string;
  parsed: unknown;
  cost: CostUsd;
}

export interface ProviderBatchResult {
  status: 'in_progress' | 'ended';
  results: ProviderBatchItemResult[];
}

export interface LlmProvider {
  readonly id: string;
  completeStructured(req: ProviderCompletionRequest): Promise<ProviderCompletionResult>;
  submitBatch(items: BatchItem[]): Promise<BatchHandle>;
  fetchBatch(handle: BatchHandle): Promise<ProviderBatchResult>;
}

export interface EmbeddingProvider {
  readonly id: string;
  embed(req: EmbeddingRequest): Promise<EmbeddingResult>;
}

export interface FacadeBatchItem<T> {
  customId: string;
  request: CompletionRequest<T>;
}

export interface LLMClient {
  complete<T>(req: CompletionRequest<T>): Promise<CompletionResult<T>>;
  embed(req: EmbeddingRequest): Promise<EmbeddingResult>;
  submitBatch(items: FacadeBatchItem<unknown>[]): Promise<BatchHandle>;
  fetchBatch(handle: BatchHandle): Promise<ProviderBatchResult>;
}
