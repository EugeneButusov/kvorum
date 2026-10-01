import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { OpenAiProvider, toOpenAiStrictJsonSchema } from './openai-provider.js';
import type { ProviderCompletionRequest } from '../ports.js';

function request(): ProviderCompletionRequest {
  return {
    model: 'gpt-6-luna',
    system: 'Return a summary.',
    messages: [{ role: 'user', content: 'Body' }],
    jsonSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        tldr: { type: 'string' },
        details: {
          type: 'object',
          properties: { note: { type: 'string' } },
        },
      },
      required: ['tldr'],
    },
    mode: 'sync',
  };
}

function client(overrides: Record<string, unknown> = {}): OpenAI {
  return {
    responses: { create: vi.fn() },
    files: { create: vi.fn(), content: vi.fn() },
    batches: { create: vi.fn(), retrieve: vi.fn() },
    ...overrides,
  } as unknown as OpenAI;
}

describe('toOpenAiStrictJsonSchema', () => {
  it('requires every property recursively and forbids additional properties', () => {
    expect(toOpenAiStrictJsonSchema(request().jsonSchema)).toEqual({
      type: 'object',
      properties: {
        tldr: { type: 'string' },
        details: {
          type: 'object',
          properties: { note: { type: 'string' } },
          additionalProperties: false,
          required: ['note'],
        },
      },
      additionalProperties: false,
      required: ['tldr', 'details'],
    });
  });
});

describe('OpenAiProvider', () => {
  it('uses Responses structured output and prices cached input', async () => {
    const create = vi.fn().mockResolvedValue({
      model: 'gpt-6-luna',
      status: 'completed',
      output_text: '{"tldr":"ok"}',
      output: [],
      error: null,
      incomplete_details: null,
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        input_tokens_details: { cached_tokens: 400 },
      },
    });
    const provider = new OpenAiProvider(client({ responses: { create } }));

    const result = await provider.completeStructured(request());

    expect(result.parsed).toEqual({ tldr: 'ok' });
    expect(result.cost).toMatchObject({
      totalUsd: 0.000164,
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadInputTokens: 400,
    });
    expect(create.mock.calls[0]![0]).toMatchObject({
      model: 'gpt-6-luna',
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
    });
  });

  it('rejects incomplete responses explicitly', async () => {
    const provider = new OpenAiProvider(
      client({
        responses: {
          create: vi.fn().mockResolvedValue({
            model: 'gpt-6-luna',
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [],
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
        },
      }),
    );
    await expect(provider.completeStructured(request())).rejects.toThrow(/max_output_tokens/);
  });

  it('uploads Responses JSONL and parses completed batch results at batch pricing', async () => {
    const filesCreate = vi.fn().mockResolvedValue({ id: 'file-1' });
    const batchesCreate = vi.fn().mockResolvedValue({ id: 'batch-1' });
    const batchesRetrieve = vi.fn().mockResolvedValue({
      id: 'batch-1',
      status: 'completed',
      output_file_id: 'out-1',
    });
    const outputLine = JSON.stringify({
      custom_id: 'proposal_1',
      response: {
        status_code: 200,
        body: {
          model: 'gpt-6-luna',
          status: 'completed',
          output_text: '{"tldr":"batched"}',
          output: [],
          usage: {
            input_tokens: 1000,
            output_tokens: 200,
            input_tokens_details: { cached_tokens: 400 },
          },
        },
      },
    });
    const provider = new OpenAiProvider(
      client({
        files: {
          create: filesCreate,
          content: vi.fn().mockResolvedValue({ text: async () => `${outputLine}\n` }),
        },
        batches: { create: batchesCreate, retrieve: batchesRetrieve },
      }),
    );

    const handle = await provider.submitBatch([{ customId: 'proposal_1', request: request() }]);
    expect(handle).toEqual({ id: 'batch-1', provider: 'openai' });
    const uploaded = filesCreate.mock.calls[0]![0].file as File;
    expect(await uploaded.text()).toContain('"url":"/v1/responses"');
    expect(batchesCreate).toHaveBeenCalledWith({
      input_file_id: 'file-1',
      endpoint: '/v1/responses',
      completion_window: '24h',
    });

    const result = await provider.fetchBatch(handle);
    expect(result.results[0]).toMatchObject({
      customId: 'proposal_1',
      parsed: { tldr: 'batched' },
      cost: { totalUsd: 0.000082 },
    });
  });
});
