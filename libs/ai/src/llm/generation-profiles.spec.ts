import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  completionRequestFromRendered,
  readActiveCompletionProvider,
  resolveGenerationProfile,
} from './generation-profiles.js';
import { ModelTier } from './ports.js';

const previous = process.env['AI_LLM_PROVIDER'];

afterEach(() => {
  if (previous === undefined) delete process.env['AI_LLM_PROVIDER'];
  else process.env['AI_LLM_PROVIDER'] = previous;
});

describe('generation profiles', () => {
  it('defaults to Anthropic and resolves both providers deterministically', () => {
    delete process.env['AI_LLM_PROVIDER'];
    expect(readActiveCompletionProvider()).toBe('anthropic');
    expect(resolveGenerationProfile(ModelTier.Fast)).toMatchObject({
      id: 'anthropic-fast-v1',
      model: 'claude-haiku-4-5',
    });
    expect(resolveGenerationProfile(ModelTier.Strong, 'openai')).toMatchObject({
      id: 'openai-strong-v1',
      model: 'gpt-6.1-sol',
    });
  });

  it('fails fast on an unsupported provider', () => {
    expect(() => readActiveCompletionProvider('other')).toThrow(/AI_LLM_PROVIDER/);
  });

  it('resolves a rendered tier before the request reaches cache or provider', () => {
    const req = completionRequestFromRendered(
      {
        feature: 'proposal_summarizer',
        promptVersion: 'v1.0',
        modelTier: ModelTier.Fast,
        schema: z.object({ tldr: z.string() }),
        messages: [{ role: 'user', content: 'summarize' }],
        inputContent: 'body',
      },
      { mode: 'sync', provider: 'openai' },
    );
    expect(req).toMatchObject({
      provider: 'openai',
      model: 'gpt-6-luna',
      generationProfileId: 'openai-fast-v1',
    });
  });
});
