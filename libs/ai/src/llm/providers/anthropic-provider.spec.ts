import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropic-provider.js';
import type { ProviderCompletionRequest } from '../ports.js';

function mockClient(over: Partial<{ create: unknown; batches: unknown }> = {}): Anthropic {
  const create =
    over.create ??
    vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"tldr":"raises reserve factor"}' }],
      usage: { input_tokens: 1000, output_tokens: 200 },
    });
  return {
    messages: { create, batches: over.batches ?? {} },
  } as unknown as Anthropic;
}

const req: ProviderCompletionRequest = {
  model: 'claude-haiku-4-5',
  messages: [{ role: 'user', content: 'summarize' }],
  jsonSchema: { type: 'object', properties: { tldr: { type: 'string' } }, required: ['tldr'] },
  mode: 'sync',
};

describe('AnthropicProvider.completeStructured', () => {
  it('parses the JSON text block and computes cost from usage', async () => {
    const provider = new AnthropicProvider(mockClient());
    const res = await provider.completeStructured(req);

    expect(res.parsed).toEqual({ tldr: 'raises reserve factor' });
    // haiku: $1/MTok in, $5/MTok out → 1000/1e6*1 + 200/1e6*5 = 0.001 + 0.001 = 0.002
    expect(res.cost.totalUsd).toBeCloseTo(0.002, 9);
    expect(res.cost.inputTokens).toBe(1000);
    expect(res.cost.outputTokens).toBe(200);
  });

  it('passes the json schema through output_config.format', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"tldr":"x"}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const provider = new AnthropicProvider(mockClient({ create }));
    await provider.completeStructured(req);
    const passed = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(passed['output_config']).toEqual({
      format: { type: 'json_schema', schema: req.jsonSchema },
    });
    expect(passed['model']).toBe('claude-haiku-4-5');
  });

  it('has id "anthropic"', () => {
    expect(new AnthropicProvider(mockClient()).id).toBe('anthropic');
  });

  it('rejects when the model has no configured pricing', async () => {
    const provider = new AnthropicProvider(mockClient());
    await expect(
      provider.completeStructured({ ...req, model: 'claude-unknown-9' }),
    ).rejects.toThrow('No Anthropic pricing configured for model "claude-unknown-9"');
  });
});

describe('AnthropicProvider batch primitives', () => {
  it('submitBatch returns a handle and fetchBatch maps results', async () => {
    const batches = {
      create: vi.fn().mockResolvedValue({ id: 'batch_123' }),
      retrieve: vi.fn().mockResolvedValue({ processing_status: 'ended' }),
      results: vi.fn().mockReturnValue(
        (async function* () {
          yield {
            custom_id: 'p-1',
            result: {
              type: 'succeeded',
              message: {
                content: [{ type: 'text', text: '{"tldr":"y"}' }],
                usage: { input_tokens: 10, output_tokens: 2 },
              },
            },
          };
        })(),
      ),
    };
    const provider = new AnthropicProvider(mockClient({ batches }));

    const handle = await provider.submitBatch([{ customId: 'p-1', request: req }]);
    expect(handle).toEqual({ id: 'batch_123', provider: 'anthropic' });

    const out = await provider.fetchBatch(handle);
    expect(out.status).toBe('ended');
    expect(out.results[0]?.customId).toBe('p-1');
    expect(out.results[0]?.parsed).toEqual({ tldr: 'y' });
    // batch price = 50%: 10/1e6*1*0.5 + 2/1e6*5*0.5
    expect(out.results[0]?.cost.totalUsd).toBeCloseTo(0.000005 + 0.000005, 12);
  });

  it('fetchBatch reports in_progress with no results', async () => {
    const batches = { retrieve: vi.fn().mockResolvedValue({ processing_status: 'in_progress' }) };
    const provider = new AnthropicProvider(mockClient({ batches }));
    const out = await provider.fetchBatch({ id: 'b', provider: 'anthropic' });
    expect(out).toEqual({ status: 'in_progress', results: [] });
  });

  it('fetchBatch throws when no submitBatch model record exists for the batch (e.g. after a process restart)', async () => {
    const batches = {
      retrieve: vi.fn().mockResolvedValue({ processing_status: 'ended' }),
      results: vi.fn().mockReturnValue(
        (async function* () {
          yield {
            custom_id: 'p-1',
            result: {
              type: 'succeeded',
              message: {
                content: [{ type: 'text', text: '{"tldr":"y"}' }],
                usage: { input_tokens: 10, output_tokens: 2 },
              },
            },
          };
        })(),
      ),
    };
    // Fresh provider — no prior submitBatch call, so the model map is empty.
    const provider = new AnthropicProvider(mockClient({ batches }));

    await expect(provider.fetchBatch({ id: 'batch_123', provider: 'anthropic' })).rejects.toThrow(
      'Cannot price batch result for custom_id "p-1": no submitBatch model record for batch "batch_123" in this process',
    );
  });
});
