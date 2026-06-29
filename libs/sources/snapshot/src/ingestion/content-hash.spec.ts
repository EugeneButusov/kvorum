import { describe, it, expect } from 'vitest';
import { contentHash } from './content-hash';

describe('contentHash', () => {
  it('is stable regardless of object key order', () => {
    const a = contentHash({ id: '0x1', title: 'A', scores_state: 'active' });
    const b = contentHash({ scores_state: 'active', title: 'A', id: '0x1' });
    expect(a).toBe(b);
  });

  it('is stable for nested objects/arrays', () => {
    const a = contentHash({ id: '0x1', choices: ['Yes', 'No'], space: { id: 'lido.eth' } });
    const b = contentHash({ space: { id: 'lido.eth' }, choices: ['Yes', 'No'], id: '0x1' });
    expect(a).toBe(b);
  });

  it('changes when an edit-salient field changes (title)', () => {
    const before = contentHash({ id: '0x1', title: 'A' });
    const after = contentHash({ id: '0x1', title: 'B' });
    expect(before).not.toBe(after);
  });

  it('changes on the active→final scores_state flip', () => {
    const active = contentHash({ id: '0x1', scores_state: 'active', scores: [1, 2] });
    const final = contentHash({ id: '0x1', scores_state: 'final', scores: [3, 4] });
    expect(active).not.toBe(final);
  });

  it('produces a hex sha256 digest', () => {
    expect(contentHash({ id: '0x1' })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles null, undefined, and primitive slices', () => {
    expect(contentHash(null)).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(undefined)).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(42)).toMatch(/^[0-9a-f]{64}$/);
  });
});
