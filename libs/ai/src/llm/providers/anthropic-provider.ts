import Anthropic from '@anthropic-ai/sdk';
import type {
  BatchHandle,
  BatchItem,
  CostUsd,
  LlmProvider,
  ProviderBatchItemResult,
  ProviderBatchResult,
  ProviderCompletionRequest,
  ProviderCompletionResult,
} from '../ports.js';

interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const ANTHROPIC_PRICING: Record<string, Pricing> = {
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
};

const DEFAULT_MAX_TOKENS = 4096;

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}
interface AnthropicTextBlock {
  type: string;
  text?: string;
}
interface AnthropicMessage {
  content: AnthropicTextBlock[];
  usage: AnthropicUsage;
}

function firstText(msg: AnthropicMessage): string {
  const block = msg.content.find((b) => b.type === 'text' && typeof b.text === 'string');
  if (!block || typeof block.text !== 'string') {
    throw new Error('Anthropic response contained no text block to parse');
  }
  return block.text;
}

function priceFor(model: string): Pricing {
  const p = ANTHROPIC_PRICING[model];
  if (!p) throw new Error(`No Anthropic pricing configured for model "${model}"`);
  return p;
}

function cost(model: string, usage: AnthropicUsage, batch: boolean): CostUsd {
  const p = priceFor(model);
  const factor = batch ? 0.5 : 1;
  const totalUsd =
    (usage.input_tokens / 1_000_000) * p.inputPerMTok * factor +
    (usage.output_tokens / 1_000_000) * p.outputPerMTok * factor;
  return { totalUsd, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
}

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';

  constructor(private readonly client: Anthropic) {}

  async completeStructured(req: ProviderCompletionRequest): Promise<ProviderCompletionResult> {
    const msg = (await this.client.messages.create({
      model: req.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      output_config: { format: { type: 'json_schema', schema: req.jsonSchema } },
    })) as unknown as AnthropicMessage;

    return {
      parsed: JSON.parse(firstText(msg)),
      cost: cost(req.model, msg.usage, false),
    };
  }

  async submitBatch(items: BatchItem[]): Promise<BatchHandle> {
    const batch = await this.client.messages.batches.create({
      requests: items.map((item) => ({
        custom_id: item.customId,
        params: {
          model: item.request.model,
          max_tokens: DEFAULT_MAX_TOKENS,
          ...(item.request.system ? { system: item.request.system } : {}),
          messages: item.request.messages.map((m) => ({ role: m.role, content: m.content })),
          output_config: { format: { type: 'json_schema', schema: item.request.jsonSchema } },
        },
      })),
    });

    return { id: batch.id, provider: this.id };
  }

  async fetchBatch(
    handle: BatchHandle,
    modelByCustomId: Record<string, string>,
  ): Promise<ProviderBatchResult> {
    const status = await this.client.messages.batches.retrieve(handle.id);
    if (status.processing_status !== 'ended') {
      return { status: 'in_progress', results: [] };
    }

    const results: ProviderBatchItemResult[] = [];
    const stream = await this.client.messages.batches.results(handle.id);
    for await (const entry of stream as AsyncIterable<{
      custom_id: string;
      result: { type: string; message?: AnthropicMessage };
    }>) {
      if (entry.result.type !== 'succeeded' || !entry.result.message) continue;
      const message = entry.result.message;
      // The Message Batches results stream does not reliably echo the request model, so pricing
      // uses the model the caller recorded per custom_id in durable batch state. A missing entry
      // means a real inconsistency (not a restart), so we throw rather than silently book $0.
      const model = modelByCustomId[entry.custom_id];
      if (!model) {
        throw new Error(
          `Cannot price batch result for custom_id "${entry.custom_id}": no model supplied for batch "${handle.id}"`,
        );
      }
      results.push({
        customId: entry.custom_id,
        parsed: JSON.parse(firstText(message)),
        cost: cost(model, message.usage, true),
      });
    }
    return { status: 'ended', results };
  }
}

export function createAnthropicProvider(opts: {
  apiKey: string;
  maxRetries?: number;
}): AnthropicProvider {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: opts.maxRetries ?? 3 });
  return new AnthropicProvider(client);
}
