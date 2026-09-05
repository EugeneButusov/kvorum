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
  // Why this model was chosen, for features that auto-route between models (forum synthesizer:
  // 'long' | 'contentious' | 'short'). Absent for single-model features. SPEC §5.7.
  routingReason?: string;
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
  // Optional model-routing rationale, copied verbatim into the output's provenance (SPEC §5.7). Set by
  // auto-routing features (forum synthesizer); ignored by the provider (not sent to the model).
  routingReason?: string;
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
  // `modelByCustomId` is supplied by the caller (from durable state) so pricing survives a restart —
  // the Message Batches results stream doesn't reliably echo the request model. See ANTHROPIC pricing.
  fetchBatch(
    handle: BatchHandle,
    modelByCustomId: Record<string, string>,
  ): Promise<ProviderBatchResult>;
}

export interface EmbeddingProvider {
  readonly id: string;
  embed(req: EmbeddingRequest): Promise<EmbeddingResult>;
}

export interface FacadeBatchItem<T> {
  customId: string;
  request: CompletionRequest<T>;
}

/**
 * The durable, serializable description of one submitted batch item — enough to re-price, re-validate
 * and persist its result after a restart, without the non-serializable Zod `schema` or the large
 * `inputContent` (only its already-computed `inputHash` is kept). Stored as the `ai_batch.items` jsonb.
 */
export interface BatchItemDescriptor {
  customId: string;
  feature: string;
  promptVersion: string;
  model: string;
  inputHash: string;
  routingReason?: string;
  daoId: string | null;
  entityReference: string | null;
}

export interface LLMClient {
  complete<T>(req: CompletionRequest<T>): Promise<CompletionResult<T>>;
  embed(req: EmbeddingRequest): Promise<EmbeddingResult>;
  submitBatch(items: FacadeBatchItem<unknown>[]): Promise<BatchHandle>;
  fetchBatch(
    handle: BatchHandle,
    modelByCustomId: Record<string, string>,
  ): Promise<ProviderBatchResult>;
}
