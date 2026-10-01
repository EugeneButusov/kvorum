import OpenAI from 'openai';
import type {
  BatchHandle,
  BatchItem,
  CostUsd,
  JsonSchema,
  LlmProvider,
  ProviderBatchItemResult,
  ProviderBatchResult,
  ProviderCompletionRequest,
  ProviderCompletionResult,
} from '../ports.js';

interface Pricing {
  inputPerMTok: number;
  cachedInputPerMTok: number;
  outputPerMTok: number;
}

export const OPENAI_COMPLETION_PRICING: Record<string, Pricing> = {
  'gpt-6-luna': { inputPerMTok: 0.1, cachedInputPerMTok: 0.01, outputPerMTok: 0.5 },
  'gpt-6.1-sol': { inputPerMTok: 2, cachedInputPerMTok: 0.1, outputPerMTok: 10 },
};

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const RESPONSE_SCHEMA_NAME = 'kvorum_structured_output';

interface OpenAiUsage {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { cached_tokens?: number };
}

interface OpenAiResponseBody {
  model: string;
  output_text?: string;
  status?: string;
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  usage?: OpenAiUsage;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
}

interface OpenAiBatchLine {
  custom_id: string;
  response?: { status_code: number; body?: OpenAiResponseBody };
  error?: { message?: string } | null;
}

function pricingFor(model: string): Pricing {
  const exact = OPENAI_COMPLETION_PRICING[model];
  if (exact) return exact;
  const alias = Object.entries(OPENAI_COMPLETION_PRICING).find(([name]) => model.startsWith(name));
  if (alias) return alias[1];
  throw new Error(`No OpenAI completion pricing configured for model "${model}"`);
}

function completionCost(model: string, usage: OpenAiUsage, batch: boolean): CostUsd {
  const pricing = pricingFor(model);
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const uncached = Math.max(0, usage.input_tokens - cached);
  const factor = batch ? 0.5 : 1;
  return {
    totalUsd:
      ((uncached * pricing.inputPerMTok +
        cached * pricing.cachedInputPerMTok +
        usage.output_tokens * pricing.outputPerMTok) /
        1_000_000) *
      factor,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: cached,
  };
}

/** OpenAI strict Structured Outputs requires every object field and forbids extra properties. */
export function toOpenAiStrictJsonSchema(schema: JsonSchema): JsonSchema {
  function normalize(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(normalize);
    if (node === null || typeof node !== 'object') return node;
    const source = node as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (key === '$schema') continue;
      result[key] = normalize(value);
    }
    if (result['type'] === 'object' && isRecord(result['properties'])) {
      result['additionalProperties'] = false;
      result['required'] = Object.keys(result['properties']);
    }
    return result;
  }
  return normalize(schema) as JsonSchema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function responseBody(req: ProviderCompletionRequest): Record<string, unknown> {
  return {
    model: req.model,
    store: false,
    max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    ...(req.system ? { instructions: req.system } : {}),
    input: req.messages.map((message) => ({ role: message.role, content: message.content })),
    text: {
      format: {
        type: 'json_schema',
        name: RESPONSE_SCHEMA_NAME,
        strict: true,
        schema: toOpenAiStrictJsonSchema(req.jsonSchema),
      },
    },
  };
}

function extractParsed(body: OpenAiResponseBody): unknown {
  if (body.error) {
    throw new Error(`OpenAI response failed: ${body.error.message ?? 'unknown error'}`);
  }
  if (body.status === 'incomplete') {
    throw new Error(
      `OpenAI response incomplete: ${body.incomplete_details?.reason ?? 'unknown reason'}`,
    );
  }
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'refusal') {
        throw new Error(`OpenAI response refused: ${content.refusal ?? 'no reason provided'}`);
      }
    }
  }
  const text = body.output_text ?? extractOutputText(body.output ?? []);
  if (!text) throw new Error('OpenAI response contained no output text to parse');
  return JSON.parse(text);
}

function extractOutputText(output: NonNullable<OpenAiResponseBody['output']>): string | undefined {
  for (const item of output) {
    const block = item.content?.find(
      (content) => content.type === 'output_text' && typeof content.text === 'string',
    );
    if (block?.text) return block.text;
  }
  return undefined;
}

export class OpenAiProvider implements LlmProvider {
  readonly id = 'openai';

  constructor(private readonly client: OpenAI) {}

  async completeStructured(req: ProviderCompletionRequest): Promise<ProviderCompletionResult> {
    const response = (await this.client.responses.create(
      responseBody(req) as never,
    )) as unknown as OpenAiResponseBody;
    if (!response.usage) throw new Error('OpenAI response contained no usage data');
    return {
      parsed: extractParsed(response),
      cost: completionCost(req.model, response.usage, false),
    };
  }

  async submitBatch(items: BatchItem[]): Promise<BatchHandle> {
    if (items.length === 0) throw new Error('Cannot submit an empty OpenAI batch');
    const jsonl = items
      .map((item) =>
        JSON.stringify({
          custom_id: item.customId,
          method: 'POST',
          url: '/v1/responses',
          body: responseBody(item.request),
        }),
      )
      .join('\n');
    const file = await this.client.files.create({
      file: new File([jsonl], 'kvorum-responses-batch.jsonl', { type: 'application/jsonl' }),
      purpose: 'batch',
    });
    const batch = await this.client.batches.create({
      input_file_id: file.id,
      endpoint: '/v1/responses',
      completion_window: '24h',
    });
    return { id: batch.id, provider: this.id };
  }

  async fetchBatch(handle: BatchHandle): Promise<ProviderBatchResult> {
    if (handle.provider !== this.id) {
      throw new Error(`Cannot fetch ${handle.provider} batch with the OpenAI provider`);
    }
    const batch = await this.client.batches.retrieve(handle.id);
    if (['validating', 'in_progress', 'finalizing', 'cancelling'].includes(batch.status)) {
      return { status: 'in_progress', results: [] };
    }
    if (!batch.output_file_id) {
      if (batch.status === 'completed') {
        throw new Error(`OpenAI batch "${handle.id}" completed without an output file`);
      }
      throw new Error(`OpenAI batch "${handle.id}" ended with status "${batch.status}"`);
    }
    const contents = await this.client.files.content(batch.output_file_id);
    const lines = (await contents.text()).split('\n').filter(Boolean);
    const results: ProviderBatchItemResult[] = [];
    for (const line of lines) {
      const entry = JSON.parse(line) as OpenAiBatchLine;
      if (entry.error || entry.response?.status_code !== 200 || !entry.response.body) continue;
      const body = entry.response.body;
      if (!body.usage) throw new Error(`OpenAI batch item "${entry.custom_id}" has no usage data`);
      results.push({
        customId: entry.custom_id,
        parsed: extractParsed(body),
        cost: completionCost(body.model, body.usage, true),
      });
    }
    return { status: 'ended', results };
  }
}

export function createOpenAiProvider(opts: {
  apiKey: string;
  maxRetries?: number;
}): OpenAiProvider {
  return new OpenAiProvider(new OpenAI({ apiKey: opts.apiKey, maxRetries: opts.maxRetries ?? 3 }));
}
