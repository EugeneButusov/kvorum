import { describe, expect, it } from 'vitest';
import { contentHash } from './content-hash';

describe('contentHash', () => {
  it('is a 64-char hex sha256 digest', () => {
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    const slice = { host: 'h', topicId: 1, posts: [{ id: 1, cooked: '<p>x</p>' }] };
    expect(contentHash(slice)).toBe(contentHash(slice));
  });

  it('is independent of object key order', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ host: 'h', topicId: 1 })).toBe(contentHash({ topicId: 1, host: 'h' }));
  });

  it('changes when any content changes', () => {
    const base = { host: 'h', posts: [{ id: 1, cooked: '<p>x</p>' }] };
    expect(contentHash(base)).not.toBe(
      contentHash({ host: 'h', posts: [{ id: 1, cooked: '<p>edited</p>' }] }),
    );
    expect(contentHash(base)).not.toBe(contentHash({ host: 'h2', posts: base.posts }));
  });

  it('preserves array order (not treated as a set)', () => {
    expect(contentHash([1, 2, 3])).not.toBe(contentHash([3, 2, 1]));
  });

  it('handles primitives, null, and undefined property values', () => {
    expect(contentHash(null)).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash('str')).toMatch(/^[0-9a-f]{64}$/);
    // An undefined property value serialises to the same `null` sentinel as an explicit null, so
    // it hashes stably rather than throwing.
    expect(contentHash({ a: undefined })).toBe(contentHash({ a: null }));
  });
});
