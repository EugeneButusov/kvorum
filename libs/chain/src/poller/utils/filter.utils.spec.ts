import { describe, expect, it } from 'vitest';
import { lowercaseFilter } from './filter.utils.js';
import type { LogFilter } from '../types.js';

describe('lowercaseFilter', () => {
  it('lowercases a single address', () => {
    const out = lowercaseFilter({ address: '0xABCDEF' });
    expect(out.address).toBe('0xabcdef');
  });

  it('lowercases each entry in an address array', () => {
    const out = lowercaseFilter({ address: ['0xAA', '0xBB'] });
    expect(out.address).toEqual(['0xaa', '0xbb']);
  });

  it('lowercases topic strings', () => {
    const out = lowercaseFilter({ address: '0xAA', topics: ['0xDEADBEEF'] });
    expect(out.topics).toEqual(['0xdeadbeef']);
  });

  it('preserves null topic entries (wildcard at position)', () => {
    const out = lowercaseFilter({ address: '0xAA', topics: [null, '0xBB'] });
    expect(out.topics).toEqual([null, '0xbb']);
  });

  it('lowercases nested OR-match topic arrays', () => {
    const out = lowercaseFilter({ address: '0xAA', topics: [['0xAA', '0xBB']] });
    expect(out.topics).toEqual([['0xaa', '0xbb']]);
  });

  it('omits topics when not provided', () => {
    const out = lowercaseFilter({ address: '0xAA' });
    expect(out.topics).toBeUndefined();
  });

  it('does not mutate the input filter', () => {
    const input: LogFilter = { address: '0xAABB', topics: ['0xCC'] };
    lowercaseFilter(input);
    expect(input.address).toBe('0xAABB');
    expect(input.topics).toEqual(['0xCC']);
  });

  it('does not mutate nested topic arrays', () => {
    const nested = ['0xAA', '0xBB'];
    const input: LogFilter = { address: '0xCC', topics: [nested] };
    lowercaseFilter(input);
    expect(nested).toEqual(['0xAA', '0xBB']);
  });
});
