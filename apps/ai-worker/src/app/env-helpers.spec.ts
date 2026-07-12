import { describe, expect, it } from 'vitest';
import { readPositiveInt } from './env-helpers';

describe('readPositiveInt', () => {
  it('returns fallback when env var is not set', () => {
    expect(readPositiveInt('__UNSET_VAR__', 10)).toBe(10);
  });

  it('returns parsed integer when env var is a positive integer', () => {
    process.env['__TEST_INT__'] = '42';
    expect(readPositiveInt('__TEST_INT__', 10)).toBe(42);
    delete process.env['__TEST_INT__'];
  });

  it('returns fallback when env var is not a number', () => {
    process.env['__TEST_INT__'] = 'abc';
    expect(readPositiveInt('__TEST_INT__', 10)).toBe(10);
    delete process.env['__TEST_INT__'];
  });

  it('returns fallback when env var is zero', () => {
    process.env['__TEST_INT__'] = '0';
    expect(readPositiveInt('__TEST_INT__', 10)).toBe(10);
    delete process.env['__TEST_INT__'];
  });

  it('returns fallback when env var is negative', () => {
    process.env['__TEST_INT__'] = '-5';
    expect(readPositiveInt('__TEST_INT__', 10)).toBe(10);
    delete process.env['__TEST_INT__'];
  });
});
