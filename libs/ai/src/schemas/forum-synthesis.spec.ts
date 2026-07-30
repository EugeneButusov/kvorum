import { describe, expect, it } from 'vitest';
import {
  FORUM_SYNTHESIS_SCHEMA_NAME,
  ForumSynthesisSchema,
  forumSkipMarker,
  isForumSkip,
} from './forum-synthesis.js';
import { toStrippedJsonSchema } from '../llm/schema.js';

function valid() {
  return {
    arguments_for: [{ summary: 'ships value', supporting_participants: ['alice', 'bob'] }],
    arguments_against: [{ summary: 'too costly', supporting_participants: ['carol'] }],
    unresolved_concerns: [{ summary: 'audit timing', raised_by: ['dave'] }],
    notable_participants: [{ handle: 'alice', role_summary: 'proposer' }],
    sentiment: 'mixed' as const,
    thread_health: 'constructive' as const,
  };
}

describe('ForumSynthesisSchema', () => {
  it('has the registry schema-label matching the template frontmatter', () => {
    expect(FORUM_SYNTHESIS_SCHEMA_NAME).toBe('ForumSynthesisSchema');
  });

  it('parses a well-formed synthesis', () => {
    expect(ForumSynthesisSchema.parse(valid())).toEqual(valid());
  });

  it('rejects an out-of-range sentiment / thread_health enum', () => {
    expect(() => ForumSynthesisSchema.parse({ ...valid(), sentiment: 'angry' })).toThrow();
    expect(() => ForumSynthesisSchema.parse({ ...valid(), thread_health: 'toxic' })).toThrow();
  });

  it('enforces the array caps as a backstop (7 for/against, 5 participants, 3 raised_by, 10 notable)', () => {
    const arg = { summary: 's', supporting_participants: [] as string[] };
    expect(() =>
      ForumSynthesisSchema.parse({ ...valid(), arguments_for: Array(8).fill(arg) }),
    ).toThrow();
    expect(() =>
      ForumSynthesisSchema.parse({
        ...valid(),
        arguments_against: [{ summary: 's', supporting_participants: Array(6).fill('x') }],
      }),
    ).toThrow();
    expect(() =>
      ForumSynthesisSchema.parse({
        ...valid(),
        unresolved_concerns: [{ summary: 's', raised_by: Array(4).fill('x') }],
      }),
    ).toThrow();
    expect(() =>
      ForumSynthesisSchema.parse({
        ...valid(),
        notable_participants: Array(11).fill({ handle: 'h', role_summary: 'r' }),
      }),
    ).toThrow();
  });

  // The array caps are Zod-only: the JSON schema the model sees has size keywords stripped, so the
  // prompt must restate the limits. This locks that contract in — if it ever regresses, revisit the prompt.
  it('produces a model-facing JSON schema with the size caps stripped', () => {
    const json = JSON.stringify(toStrippedJsonSchema(ForumSynthesisSchema));
    expect(json).not.toContain('maxItems');
    expect(json).not.toContain('maxLength');
  });
});

describe('forum skip marker', () => {
  it('builds the non-English marker', () => {
    expect(forumSkipMarker('non_english')).toEqual({ _meta: { skipped_reason: 'non_english' } });
  });

  it('recognises a skip marker and rejects a real synthesis / junk', () => {
    expect(isForumSkip(forumSkipMarker('non_english'))).toBe(true);
    expect(isForumSkip(valid())).toBe(false);
    expect(isForumSkip(null)).toBe(false);
    expect(isForumSkip({ _meta: {} })).toBe(false);
    expect(isForumSkip('non_english')).toBe(false);
  });
});
