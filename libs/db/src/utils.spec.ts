import { describe, it, expect } from 'vitest';
import { isTransientDbError } from './utils';

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
