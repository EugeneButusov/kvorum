import { describe, it, expect } from 'vitest';
import { isCanonicalPartialUniqueViolation, isTransientDbError } from './utils';

describe('isTransientDbError', () => {
  it.each([
    '08000',
    '08001',
    '08003',
    '08006',
    '08007',
    '57P01',
    '57P02',
    '57P03',
    '40001',
    '40P01',
    '53300',
    '08004',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
  ])('code %s → true', (code) => {
    expect(isTransientDbError({ code })).toBe(true);
  });

  it.each(['23503', '42703', 'UNKNOWN', ''])('code %s → false', (code) => {
    expect(isTransientDbError({ code })).toBe(false);
  });

  it('plain string → false', () => {
    expect(isTransientDbError('ECONNRESET')).toBe(false);
  });

  it('null → false', () => {
    expect(isTransientDbError(null)).toBe(false);
  });
});

describe('isCanonicalPartialUniqueViolation', () => {
  it('23505 + idx_archive_confirmation_canonical → true', () => {
    expect(
      isCanonicalPartialUniqueViolation({
        code: '23505',
        constraint: 'idx_archive_confirmation_canonical',
      }),
    ).toBe(true);
  });

  it('23505 + different constraint → false', () => {
    expect(
      isCanonicalPartialUniqueViolation({
        code: '23505',
        constraint: 'archive_confirmation_idempotency_key',
      }),
    ).toBe(false);
  });

  it('23503 + any constraint → false', () => {
    expect(
      isCanonicalPartialUniqueViolation({
        code: '23503',
        constraint: 'idx_archive_confirmation_canonical',
      }),
    ).toBe(false);
  });
});
