import { describe, expect, it } from 'vitest';
import { loadAbiLibrary } from './index';

describe('loadAbiLibrary', () => {
  it('returns a non-empty bySelector map', () => {
    const lib = loadAbiLibrary();
    expect(lib.bySelector.size).toBeGreaterThan(0);
  });

  it('is memoized', () => {
    expect(loadAbiLibrary()).toBe(loadAbiLibrary());
  });

  it('keeps selector keys aligned with their fragments', () => {
    const lib = loadAbiLibrary();

    for (const [selector, bucket] of lib.bySelector) {
      for (const entry of bucket) {
        expect(entry.fragment.selector.toLowerCase()).toBe(selector);
      }
    }
  });

  it('loads without selector collisions', () => {
    const lib = loadAbiLibrary();

    for (const [selector, bucket] of lib.bySelector) {
      expect(bucket, selector).toHaveLength(1);
    }
  });
});
