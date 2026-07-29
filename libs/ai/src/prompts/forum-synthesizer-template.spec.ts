import { describe, expect, it } from 'vitest';
import { FORUM_SYNTHESIZER_TEMPLATE } from './forum-synthesizer-template.js';
import { render } from './renderer.js';

describe('FORUM_SYNTHESIZER_TEMPLATE', () => {
  it('loads under the forum_synthesizer feature with a priced default model', () => {
    expect(FORUM_SYNTHESIZER_TEMPLATE.name).toBe('forum_synthesizer');
    expect(FORUM_SYNTHESIZER_TEMPLATE.feature ?? FORUM_SYNTHESIZER_TEMPLATE.name).toBe(
      'forum_synthesizer',
    );
    expect(FORUM_SYNTHESIZER_TEMPLATE.model).toBe('claude-haiku-4-5');
  });

  it('renders the thread content, proposal title and DAO into the prompt', () => {
    const r = render(FORUM_SYNTHESIZER_TEMPLATE, {
      proposal_title: 'Raise the USDC reserve factor',
      dao_name: 'Compound',
      thread_content: '**@alice** at 2026-01-01T00:00:00Z\n\nStrong support from me.',
    });
    const text = r.messages[0]?.content ?? '';
    expect(text).toContain('Raise the USDC reserve factor');
    expect(text).toContain('Compound');
    expect(text).toContain('Strong support from me.');
    expect(r.feature).toBe('forum_synthesizer');
  });

  // The array caps live in prose because toStrippedJsonSchema removes maxItems (see the schema spec).
  it('states the item caps in prose so the model complies', () => {
    expect(FORUM_SYNTHESIZER_TEMPLATE.body).toContain('At most 7');
    expect(FORUM_SYNTHESIZER_TEMPLATE.body).toContain('At most 5');
    expect(FORUM_SYNTHESIZER_TEMPLATE.body).toContain('At most 10');
  });
});
