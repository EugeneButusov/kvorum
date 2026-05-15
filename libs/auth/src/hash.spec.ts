import { hashApiKey, verifyApiKey } from './hash';

function pepper(byte: number): Buffer {
  return Buffer.alloc(32, byte);
}

describe('hashApiKey', () => {
  const key = 'kv_live_aB01_-aB01_-aB01_-aB01_-aB01_-aB';

  it('is deterministic for same inputs', () => {
    const first = hashApiKey(pepper(1), key);
    const second = hashApiKey(pepper(1), key);

    expect(first.equals(second)).toBe(true);
    expect(first).toHaveLength(32);
  });

  it('differs for different peppers', () => {
    const first = hashApiKey(pepper(1), key);
    const second = hashApiKey(pepper(2), key);

    expect(first.equals(second)).toBe(false);
  });
});

describe('verifyApiKey', () => {
  const key = 'kv_live_aB01_-aB01_-aB01_-aB01_-aB01_-aB';

  it('returns true for matching key/hash', () => {
    const p = pepper(1);
    const hash = hashApiKey(p, key);
    expect(verifyApiKey(p, key, hash)).toBe(true);
  });

  it('returns false for wrong key', () => {
    const p = pepper(1);
    const hash = hashApiKey(p, key);
    expect(verifyApiKey(p, `${key}x`, hash)).toBe(false);
  });

  it('returns false for wrong pepper', () => {
    const hash = hashApiKey(pepper(1), key);
    expect(verifyApiKey(pepper(2), key, hash)).toBe(false);
  });

  it('returns false for length mismatch', () => {
    expect(verifyApiKey(pepper(1), key, Buffer.alloc(31, 1))).toBe(false);
  });
});
