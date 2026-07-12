import { describe, expect, it, vi } from 'vitest';
import { AiFeatureHandlerRegistry } from './ai-feature-handler.registry';

describe('AiFeatureHandlerRegistry', () => {
  it('returns a registered handler and undefined for an unregistered feature', () => {
    const registry = new AiFeatureHandlerRegistry();
    const handler = { handle: vi.fn() };
    registry.register('proposal_summarizer', handler);
    expect(registry.get('proposal_summarizer')).toBe(handler);
    expect(registry.get('mismatch_detector')).toBeUndefined();
  });
});
