import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkerLlmClient, LLM_CLIENT } from './llm.provider';

describe('createWorkerLlmClient', () => {
  const saved = {
    a: process.env['ANTHROPIC_API_KEY'],
    o: process.env['OPENAI_API_KEY'],
    p: process.env['AI_LLM_PROVIDER'],
  };
  beforeEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['AI_LLM_PROVIDER'];
  });
  afterEach(() => {
    if (saved.a === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = saved.a;
    if (saved.o === undefined) delete process.env['OPENAI_API_KEY'];
    else process.env['OPENAI_API_KEY'] = saved.o;
    if (saved.p === undefined) delete process.env['AI_LLM_PROVIDER'];
    else process.env['AI_LLM_PROVIDER'] = saved.p;
  });

  it('constructs a full LLMClient even with no API keys set (boot-safe)', () => {
    const client = createWorkerLlmClient();
    expect(typeof client.complete).toBe('function');
    expect(typeof client.embed).toBe('function');
    expect(typeof client.submitBatch).toBe('function');
    expect(typeof client.fetchBatch).toBe('function');
  });

  it('exposes a stable DI token', () => {
    expect(LLM_CLIENT).toBe('LLM_CLIENT');
  });

  it('selects OpenAI completions with the global provider switch', () => {
    process.env['AI_LLM_PROVIDER'] = 'openai';
    const client = createWorkerLlmClient() as unknown as { provider: { id: string } };
    expect(client.provider.id).toBe('openai');
  });

  it('fails fast for an unsupported provider value', () => {
    process.env['AI_LLM_PROVIDER'] = 'other';
    expect(() => createWorkerLlmClient()).toThrow(/AI_LLM_PROVIDER/);
  });
});
