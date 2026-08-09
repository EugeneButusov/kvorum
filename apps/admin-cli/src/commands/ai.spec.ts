import { describe, expect, it } from 'vitest';
import { resolveRegenerateTarget } from './ai.js';

describe('resolveRegenerateTarget', () => {
  it('maps a forum synthesizer entity to its queue with the force flag', () => {
    expect(resolveRegenerateTarget('forum_synthesizer', 'forum_thread:abc-123', true)).toEqual({
      queue: 'ai_forum_synthesis',
      job: { feature: 'forum_synthesizer', entityRef: 'forum_thread:abc-123', force: true },
    });
  });

  it('defaults force to false and maps other known features', () => {
    expect(resolveRegenerateTarget('proposal_summarizer', 'proposal:p1', false)).toEqual({
      queue: 'ai_summarize',
      job: { feature: 'proposal_summarizer', entityRef: 'proposal:p1', force: false },
    });
  });

  it('rejects an unknown feature', () => {
    const out = resolveRegenerateTarget('nope', 'forum_thread:x', false);
    expect('error' in out && out.error).toMatch(/unknown AI feature/);
  });

  it('rejects a malformed entity_reference', () => {
    const out = resolveRegenerateTarget('forum_synthesizer', 'no-colon', false);
    expect('error' in out && out.error).toMatch(/invalid entity_reference/);
  });
});
