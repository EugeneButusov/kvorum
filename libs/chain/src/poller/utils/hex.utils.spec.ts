import { describe, expect, it } from 'vitest';
import { normalizeEvenLengthHex, requireHexString, requireNonNegativeInt } from './hex.utils.js';

describe('requireHexString', () => {
  it('accepts lowercase hex', () => {
    expect(requireHexString('0xabcdef', 'f')).toBe('0xabcdef');
  });

  it('accepts mixed-case hex (case-insensitive)', () => {
    expect(requireHexString('0xAbCdEf', 'f')).toBe('0xAbCdEf');
  });

  it('accepts uppercase 0X prefix', () => {
    expect(requireHexString('0XABCDEF', 'f')).toBe('0XABCDEF');
  });

  it('accepts empty hex body ("0x")', () => {
    // `data: '0x'` is the canonical empty-calldata payload — must not throw.
    expect(requireHexString('0x', 'f')).toBe('0x');
  });

  it('rejects missing 0x prefix', () => {
    expect(() => requireHexString('abcdef', 'myField')).toThrow(/non-hex myField/);
  });

  it('rejects non-hex characters', () => {
    expect(() => requireHexString('0xZZ', 'myField')).toThrow(/non-hex myField/);
  });

  it('rejects null/undefined/number', () => {
    expect(() => requireHexString(null, 'f')).toThrow();
    expect(() => requireHexString(undefined, 'f')).toThrow();
    expect(() => requireHexString(42, 'f')).toThrow();
  });
});

describe('requireNonNegativeInt', () => {
  it('coerces hex string to number', () => {
    expect(requireNonNegativeInt('0x10', 'f')).toBe(16);
  });

  it('accepts plain number', () => {
    expect(requireNonNegativeInt(7, 'f')).toBe(7);
  });

  it('accepts 0', () => {
    expect(requireNonNegativeInt('0x0', 'f')).toBe(0);
    expect(requireNonNegativeInt(0, 'f')).toBe(0);
  });

  it('rejects negative', () => {
    expect(() => requireNonNegativeInt(-1, 'myField')).toThrow(/invalid myField/);
  });

  it('rejects non-integer numbers', () => {
    expect(() => requireNonNegativeInt(1.5, 'myField')).toThrow(/invalid myField/);
  });

  it('rejects unparseable strings', () => {
    expect(() => requireNonNegativeInt('not-a-number', 'myField')).toThrow(/invalid myField/);
  });

  it('rejects null/undefined', () => {
    expect(() => requireNonNegativeInt(null, 'f')).toThrow();
    expect(() => requireNonNegativeInt(undefined, 'f')).toThrow();
  });
});

describe('normalizeEvenLengthHex', () => {
  it('returns lowercased canonical form', () => {
    expect(normalizeEvenLengthHex('0xABCDEF', 'f')).toBe('0xabcdef');
  });

  it('accepts long 32-byte-style hex', () => {
    const hash = '0x' + 'aa'.repeat(32);
    expect(normalizeEvenLengthHex(hash, 'f')).toBe(hash);
  });

  it('rejects empty body ("0x")', () => {
    expect(() => normalizeEvenLengthHex('0x', 'myField')).toThrow(/invalid hex for myField/);
  });

  it('rejects odd-length body', () => {
    expect(() => normalizeEvenLengthHex('0xabc', 'myField')).toThrow(/invalid hex for myField/);
  });

  it('rejects missing 0x prefix', () => {
    expect(() => normalizeEvenLengthHex('abcd', 'myField')).toThrow(/invalid hex for myField/);
  });

  it('rejects non-hex characters', () => {
    expect(() => normalizeEvenLengthHex('0xZZ', 'myField')).toThrow(/invalid hex for myField/);
  });

  it('error message includes the offending value', () => {
    expect(() => normalizeEvenLengthHex('garbage', 'tx')).toThrow(/"garbage"/);
  });
});
