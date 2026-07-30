import { describe, expect, it } from 'vitest';
import type { ForumThreadForSynthesis } from '@sources/forum';
import { ForumSynthesisAssembler } from './forum-synthesis.assembler';

function thread(over: Partial<ForumThreadForSynthesis> = {}): ForumThreadForSynthesis {
  return {
    id: 'thread-1',
    daoId: 'dao-1',
    daoSlug: 'compound',
    daoName: 'Compound',
    threadTitle: 'Discuss the reserve factor',
    rawContent: '**@alice** at 2026-01-01T00:00:00Z\n\nStrong support from me.',
    linkedProposalTitle: 'Raise the USDC reserve factor',
    ...over,
  };
}

describe('ForumSynthesisAssembler', () => {
  it('renders the linked proposal title, DAO and thread content into the prompt', () => {
    const { rendered, ctx, rawContent } = new ForumSynthesisAssembler().assemble(thread());
    expect(rendered.feature).toBe('forum_synthesizer');
    const text = rendered.messages[0]?.content ?? '';
    expect(text).toContain('Raise the USDC reserve factor');
    expect(text).toContain('Compound');
    expect(text).toContain('Strong support from me.');
    expect(ctx).toEqual({ daoId: 'dao-1', entityReference: 'forum_thread:thread-1' });
    expect(rawContent).toBe(thread().rawContent);
  });

  it('falls back to the thread title when there is no linked proposal title', () => {
    const { rendered } = new ForumSynthesisAssembler().assemble(
      thread({ linkedProposalTitle: null }),
    );
    expect(rendered.messages[0]?.content).toContain('Discuss the reserve factor');
  });
});
