import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmSchemaViolationError } from './errors.js';
import { FakeEmbeddingProvider, FakeLlmProvider } from './fake-provider.js';
import { createLlmClient } from './llm-client.js';
import type { CompletionRequest } from './ports.js';
import type { Clock } from './provenance.js';

const schema = z.object({ tldr: z.string() });
const fixedClock: Clock = { now: () => '2026-07-08T00:00:00.000Z' };

function req(
  overrides: Partial<CompletionRequest<{ tldr: string }>> = {},
): CompletionRequest<{ tldr: string }> {
  return {
    feature: 'proposal_summarizer',
    promptVersion: 'v1.0',
    model: 'claude-haiku-4-5',
    schema,
    messages: [{ role: 'user', content: 'summarize' }],
    mode: 'sync',
    inputContent: 'the proposal body',
    ...overrides,
  };
}

describe('DefaultLlmClient.complete', () => {
  it('validates output and populates provenance', async () => {
    const provider = new FakeLlmProvider([{ tldr: 'raises reserve factor' }]);
    const client = createLlmClient({
      provider,
      embeddingProvider: new FakeEmbeddingProvider(),
      clock: fixedClock,
    });

    const result = await client.complete(req());

    expect(result.output).toEqual({ tldr: 'raises reserve factor' });
    expect(result.provenance).toEqual({
      feature: 'proposal_summarizer',
      model: 'claude-haiku-4-5',
      promptVersion: 'v1.0',
      inputHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      generatedAt: '2026-07-08T00:00:00.000Z',
    });
    expect(provider.calls).toHaveLength(1);
  });

  it('retries once on schema violation then throws a typed error', async () => {
    // both attempts return an invalid shape (missing tldr)
    const provider = new FakeLlmProvider([{ wrong: 1 }, { wrong: 2 }]);
    const client = createLlmClient({
      provider,
      embeddingProvider: new FakeEmbeddingProvider(),
      clock: fixedClock,
    });

    await expect(client.complete(req())).rejects.toBeInstanceOf(LlmSchemaViolationError);
    expect(provider.calls).toHaveLength(2);
  });

  it('carries failure details on the typed error', async () => {
    const provider = new FakeLlmProvider([{ wrong: 1 }, { wrong: 2 }]);
    const client = createLlmClient({
      provider,
      embeddingProvider: new FakeEmbeddingProvider(),
      clock: fixedClock,
    });

    try {
      await client.complete(req());
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmSchemaViolationError);
      const e = err as LlmSchemaViolationError;
      expect(e.feature).toBe('proposal_summarizer');
      expect(e.attempts).toBe(2);
      expect(e.rawOutput).toEqual({ wrong: 2 });
      expect(e.inputHash).toMatch(/^sha256:/);
    }
  });

  it('rejects batch mode with guidance to submitBatch', async () => {
    const provider = new FakeLlmProvider([]);
    const client = createLlmClient({ provider, embeddingProvider: new FakeEmbeddingProvider() });
    await expect(client.complete(req({ mode: 'batch' }))).rejects.toThrow(/submitBatch/);
  });
});

describe('DefaultLlmClient.embed', () => {
  it('delegates to the embedding provider', async () => {
    const client = createLlmClient({
      provider: new FakeLlmProvider([]),
      embeddingProvider: new FakeEmbeddingProvider(),
    });
    const res = await client.embed({ model: 'text-embedding-3-small', input: 'hello' });
    expect(res.vector).toHaveLength(3);
    expect(res.model).toBe('text-embedding-3-small');
  });
});
