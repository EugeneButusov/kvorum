import { describe, expect, it } from 'vitest';
import { forumSynthesisInputContent, forumSynthesisInputHash } from './forum-synthesis-input.js';
import { computeInputHash } from '../llm/provenance.js';

describe('forumSynthesisInputContent/Hash', () => {
  it('is the raw_content verbatim — cache key is sha256(raw_content)', () => {
    const raw = '**@alice** at 2026-01-01T00:00:00Z\n\nI support this.';
    expect(forumSynthesisInputContent(raw)).toBe(raw);
    expect(forumSynthesisInputHash(raw)).toBe(computeInputHash(raw));
    expect(forumSynthesisInputHash(raw)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes when new posts change raw_content (a new synthesis is generated)', () => {
    const before = forumSynthesisInputHash('post one');
    const after = forumSynthesisInputHash('post one\n\n---\n\npost two');
    expect(before).not.toBe(after);
  });
});
