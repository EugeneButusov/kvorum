import {
  ModelTier,
  type CompletionMode,
  type CompletionProviderId,
  type CompletionRequest,
} from './ports.js';
import type { RenderedPrompt } from '../prompts/types.js';

export type ActiveCompletionProvider = Exclude<CompletionProviderId, 'internal' | 'fake'>;

export interface GenerationProfile {
  id: string;
  provider: ActiveCompletionProvider;
  tier: ModelTier;
  model: string;
}

export const GENERATION_PROFILES: Record<
  ActiveCompletionProvider,
  Record<ModelTier, GenerationProfile>
> = {
  anthropic: {
    [ModelTier.Fast]: {
      id: 'anthropic-fast-v1',
      provider: 'anthropic',
      tier: ModelTier.Fast,
      model: 'claude-haiku-4-5',
    },
    [ModelTier.Strong]: {
      id: 'anthropic-strong-v1',
      provider: 'anthropic',
      tier: ModelTier.Strong,
      model: 'claude-sonnet-5',
    },
  },
  openai: {
    [ModelTier.Fast]: {
      id: 'openai-fast-v1',
      provider: 'openai',
      tier: ModelTier.Fast,
      model: 'gpt-6-luna',
    },
    [ModelTier.Strong]: {
      id: 'openai-strong-v1',
      provider: 'openai',
      tier: ModelTier.Strong,
      model: 'gpt-6.1-sol',
    },
  },
};

export function readActiveCompletionProvider(
  value = process.env['AI_LLM_PROVIDER'],
): ActiveCompletionProvider {
  if (value === undefined || value === '') return 'anthropic';
  if (value === 'anthropic' || value === 'openai') return value;
  throw new Error(`AI_LLM_PROVIDER must be "anthropic" or "openai"; received "${value}"`);
}

export function resolveGenerationProfile(
  tier: ModelTier,
  provider = readActiveCompletionProvider(),
): GenerationProfile {
  return GENERATION_PROFILES[provider][tier];
}

export interface CompletionRequestOptions {
  mode: CompletionMode;
  inputContent?: string;
  modelTier?: ModelTier;
  routingReason?: string;
  provider?: ActiveCompletionProvider;
}

/** Resolve provider + exact model before cache lookup, so cache identity and provenance match billing. */
export function completionRequestFromRendered<T>(
  rendered: RenderedPrompt<T>,
  options: CompletionRequestOptions,
): CompletionRequest<T> {
  const profile = resolveGenerationProfile(
    options.modelTier ?? rendered.modelTier,
    options.provider ?? readActiveCompletionProvider(),
  );
  return {
    feature: rendered.feature,
    promptVersion: rendered.promptVersion,
    provider: profile.provider,
    model: profile.model,
    generationProfileId: profile.id,
    schema: rendered.schema,
    messages: rendered.messages,
    mode: options.mode,
    inputContent: options.inputContent ?? rendered.inputContent,
    ...(options.routingReason !== undefined ? { routingReason: options.routingReason } : {}),
  };
}
