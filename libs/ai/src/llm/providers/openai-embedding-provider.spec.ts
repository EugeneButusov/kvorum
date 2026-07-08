import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { OpenAiEmbeddingProvider } from './openai-embedding-provider.js';

function mockClient(create: unknown): OpenAI {
  return { embeddings: { create } } as unknown as OpenAI;
}

describe('OpenAiEmbeddingProvider.embed', () => {
  it('returns the vector and computes cost from prompt_tokens', async () => {
    const create = vi.fn().mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 1_000_000 },
    });
    const provider = new OpenAiEmbeddingProvider(mockClient(create));

    const res = await provider.embed({ model: 'text-embedding-3-small', input: 'hello world' });

    expect(res.vector).toEqual([0.1, 0.2, 0.3]);
    expect(res.model).toBe('text-embedding-3-small');
    // $0.02 / MTok → 1M tokens = $0.02
    expect(res.cost.totalUsd).toBeCloseTo(0.02, 9);
    expect(res.cost.inputTokens).toBe(1_000_000);
    expect(res.cost.outputTokens).toBe(0);
  });

  it('has id "openai"', () => {
    expect(new OpenAiEmbeddingProvider(mockClient(vi.fn())).id).toBe('openai');
  });

  it('rejects when the model has no configured pricing', async () => {
    const create = vi.fn().mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 1000 },
    });
    const provider = new OpenAiEmbeddingProvider(mockClient(create));

    await expect(provider.embed({ model: 'text-embedding-unknown-9', input: 'x' })).rejects.toThrow(
      'No OpenAI embedding pricing configured for model "text-embedding-unknown-9"',
    );
  });
});
