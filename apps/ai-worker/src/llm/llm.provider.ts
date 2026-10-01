import {
  createAnthropicProvider,
  createLlmClient,
  createOpenAiProvider,
  createOpenAiEmbeddingProvider,
  readActiveCompletionProvider,
  type LLMClient,
} from '@libs/ai';

export const LLM_CLIENT = 'LLM_CLIENT';

/**
 * Boot-safe LLM client factory. The Anthropic/OpenAI SDKs throw when constructed with an empty
 * key, so we fall back to an obvious sentinel when the env var is unset — the worker boots inert
 * (the summarizer trigger is off by default), and a real batch submit without a real key fails
 * loudly with an auth error rather than crashing boot.
 */
export function createWorkerLlmClient(): LLMClient {
  const openaiKey = process.env['OPENAI_API_KEY'] ?? 'unset-openai-key';
  const activeProvider = readActiveCompletionProvider();
  const provider =
    activeProvider === 'openai'
      ? createOpenAiProvider({ apiKey: openaiKey })
      : createAnthropicProvider({
          apiKey: process.env['ANTHROPIC_API_KEY'] ?? 'unset-anthropic-key',
        });
  return createLlmClient({
    provider,
    embeddingProvider: createOpenAiEmbeddingProvider({ apiKey: openaiKey }),
  });
}
