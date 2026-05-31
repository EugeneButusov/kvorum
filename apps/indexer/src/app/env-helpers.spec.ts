import { describe, expect, it } from 'vitest';
import { readIntervalMs, readPositiveInt } from './env-helpers';

describe('readIntervalMs', () => {
  it('returns fallback when env var is not set', () => {
    expect(readIntervalMs('__UNSET_VAR__', 5_000)).toBe(5_000);
  });

  it('returns parsed value when env var is a positive finite number', () => {
    process.env['__TEST_INTERVAL_MS__'] = '3000';
    expect(readIntervalMs('__TEST_INTERVAL_MS__', 5_000)).toBe(3_000);
    delete process.env['__TEST_INTERVAL_MS__'];
  });

  it('returns fallback when env var is zero', () => {
    process.env['__TEST_INTERVAL_MS__'] = '0';
    expect(readIntervalMs('__TEST_INTERVAL_MS__', 5_000)).toBe(5_000);
    delete process.env['__TEST_INTERVAL_MS__'];
  });

  it('returns fallback when env var is negative', () => {
    process.env['__TEST_INTERVAL_MS__'] = '-1000';
    expect(readIntervalMs('__TEST_INTERVAL_MS__', 5_000)).toBe(5_000);
    delete process.env['__TEST_INTERVAL_MS__'];
  });

  it('returns fallback when env var is not a number', () => {
    process.env['__TEST_INTERVAL_MS__'] = 'bad';
    expect(readIntervalMs('__TEST_INTERVAL_MS__', 5_000)).toBe(5_000);
    delete process.env['__TEST_INTERVAL_MS__'];
  });
});

describe('readPositiveInt', () => {
  it('returns fallback when env var is not set', () => {
    expect(readPositiveInt('__UNSET_VAR__', 10)).toBe(10);
  });

  it('returns parsed integer when env var is a positive integer', () => {
    process.env['__TEST_INT__'] = '42';
    expect(readPositiveInt('__TEST_INT__', 10)).toBe(42);
    delete process.env['__TEST_INT__'];
  });

  it('returns fallback when env var is zero', () => {
    process.env['__TEST_INT__'] = '0';
    expect(readPositiveInt('__TEST_INT__', 10)).toBe(10);
    delete process.env['__TEST_INT__'];
  });

  it('returns fallback when env var is not a number', () => {
    process.env['__TEST_INT__'] = 'nope';
    expect(readPositiveInt('__TEST_INT__', 10)).toBe(10);
    delete process.env['__TEST_INT__'];
  });
});
