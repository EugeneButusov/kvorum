import { describe, expect, it } from 'vitest';
import {
  chooseForumModel,
  estimateTokens,
  FORUM_MODEL_HAIKU,
  FORUM_MODEL_SONNET,
} from './forum-model-routing.js';
import { ANTHROPIC_PRICING } from './llm/providers/anthropic-provider.js';

// A short thread everyone agrees on — few markers, one-sided.
const SHORT_CALM = 'Everyone here supports this proposal. It is a clear benefit and we all agree.';

// Balanced for/against debate — meaningful markers on both sides.
const SHORT_CONTENTIOUS =
  'I support this and agree it brings a clear benefit and a real advantage. ' +
  'However, several members oppose it, disagree strongly, and reject the plan, ' +
  'citing serious risk, a design flaw, and an unacceptable downside.';

// One-sided critique — lots of opposition, no support. Not "contentious" (not polarized).
const SHORT_ONE_SIDED =
  'This is the wrong move. I oppose it. It carries huge risk and a serious flaw. ' +
  'The downside is unacceptable and I reject it outright.';

describe('estimateTokens', () => {
  it('is a ~4-chars-per-token ceiling', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(40))).toBe(10);
    expect(estimateTokens('a'.repeat(41))).toBe(11);
  });
});

describe('chooseForumModel', () => {
  it('routes short, calm threads to Haiku', () => {
    const r = chooseForumModel(SHORT_CALM);
    expect(r.model).toBe(FORUM_MODEL_HAIKU);
    expect(r.reason).toBe('short');
  });

  it('routes long threads (>=30k tokens) to Sonnet regardless of content', () => {
    const long = 'benign filler text. '.repeat(7000); // ~140k chars => ~35k tokens, no debate
    const r = chooseForumModel(long);
    expect(r.model).toBe(FORUM_MODEL_SONNET);
    expect(r.reason).toBe('long');
    expect(r.estimatedTokens).toBeGreaterThanOrEqual(30_000);
  });

  it('routes short but contentious (polarized) threads to Sonnet', () => {
    const r = chooseForumModel(SHORT_CONTENTIOUS);
    expect(r.model).toBe(FORUM_MODEL_SONNET);
    expect(r.reason).toBe('contentious');
  });

  it('does NOT flag one-sided criticism as contentious (needs both poles)', () => {
    const r = chooseForumModel(SHORT_ONE_SIDED);
    expect(r.model).toBe(FORUM_MODEL_HAIKU);
    expect(r.reason).toBe('short');
  });

  it('does NOT flag contention when there is too little signal', () => {
    const r = chooseForumModel('I support it, but there is one risk.'); // 1 vs 1 => below floor
    expect(r.model).toBe(FORUM_MODEL_HAIKU);
    expect(r.reason).toBe('short');
  });

  it('lets length win over contentiousness (checked first)', () => {
    const r = chooseForumModel(`${SHORT_CONTENTIOUS} `.repeat(2000)); // long AND contentious
    expect(r.model).toBe(FORUM_MODEL_SONNET);
    expect(r.reason).toBe('long');
  });

  it('only ever routes to models that are actually priced (else completion throws)', () => {
    expect(ANTHROPIC_PRICING[FORUM_MODEL_HAIKU]).toBeDefined();
    expect(ANTHROPIC_PRICING[FORUM_MODEL_SONNET]).toBeDefined();
  });
});
