import OpenAI from 'openai';
import type { CostUsd, EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from '../ports.js';

export const OPENAI_EMBEDDING_PRICING: Record<string, { inputPerMTok: number }> = {
  'text-embedding-3-small': { inputPerMTok: 0.02 },
};

interface OpenAiEmbeddingResponse {
  data: { embedding: number[] }[];
  usage: { prompt_tokens: number };
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'openai';

  constructor(private readonly client: OpenAI) {}

  async embed(req: EmbeddingRequest): Promise<EmbeddingResult> {
    const res = (await this.client.embeddings.create({
      model: req.model,
      input: req.input,
    })) as unknown as OpenAiEmbeddingResponse;

    const first = res.data[0];
    if (!first) throw new Error('OpenAI embedding response contained no data');

    return {
      vector: first.embedding,
      model: req.model,
      cost: this.cost(req.model, res.usage.prompt_tokens),
    };
  }

  private cost(model: string, inputTokens: number): CostUsd {
    const price = OPENAI_EMBEDDING_PRICING[model];
    if (!price) throw new Error(`No OpenAI embedding pricing configured for model "${model}"`);
    return {
      totalUsd: (inputTokens / 1_000_000) * price.inputPerMTok,
      inputTokens,
      outputTokens: 0,
    };
  }
}

export function createOpenAiEmbeddingProvider(opts: {
  apiKey: string;
  maxRetries?: number;
}): OpenAiEmbeddingProvider {
  const client = new OpenAI({ apiKey: opts.apiKey, maxRetries: opts.maxRetries ?? 3 });
  return new OpenAiEmbeddingProvider(client);
}
