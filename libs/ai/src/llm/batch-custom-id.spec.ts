import { describe, expect, it } from 'vitest';
import { toBatchCustomId } from './batch-custom-id.js';

const ANTHROPIC_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

describe('toBatchCustomId', () => {
  it('replaces the illegal colon in entity refs', () => {
    expect(toBatchCustomId('proposal:123')).toBe('proposal_123');
    expect(toBatchCustomId('forum_thread:abc')).toBe('forum_thread_abc');
  });

  it('always produces an Anthropic-valid custom_id', () => {
    for (const ref of [
      'proposal:550e8400-e29b-41d4-a716-446655440000',
      'forum_thread:compound/governance/some-very-long-external-id-with/slashes',
      'proposal:' + 'x'.repeat(200),
      'weird ref with spaces & symbols!',
    ]) {
      expect(toBatchCustomId(ref)).toMatch(ANTHROPIC_PATTERN);
    }
  });

  it('keeps hyphenated UUIDs readable and within length', () => {
    const id = toBatchCustomId('proposal:550e8400-e29b-41d4-a716-446655440000');
    expect(id).toBe('proposal_550e8400-e29b-41d4-a716-446655440000');
    expect(id.length).toBeLessThanOrEqual(64);
  });

  it('falls back to a 64-char sha256 hex when the sanitised form is too long', () => {
    const id = toBatchCustomId('proposal:' + 'x'.repeat(200));
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic and distinct per ref', () => {
    expect(toBatchCustomId('proposal:1')).toBe(toBatchCustomId('proposal:1'));
    expect(toBatchCustomId('proposal:1')).not.toBe(toBatchCustomId('proposal:2'));
  });
});
