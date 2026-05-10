import { describe, expect, it } from 'vitest';
import { buildIdempotencyKey } from './idempotency.utils.js';

const BASE = {
  sourceType: 'compound_governor',
  chainId: 1,
  txHash: '0xaabbccdd00000000000000000000000000000000000000000000000000000001',
  logIndex: 0,
  blockHash: '0xdeadbeef00000000000000000000000000000000000000000000000000000002',
};

describe('buildIdempotencyKey', () => {
  it('returns colon-delimited 5-tuple', () => {
    const key = buildIdempotencyKey(BASE);
    const parts = key.split(':');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('compound_governor');
    expect(parts[1]).toBe('1');
  });

  it('is stable across calls with identical inputs', () => {
    expect(buildIdempotencyKey(BASE)).toBe(buildIdempotencyKey(BASE));
  });

  it('produces distinct keys for different blockHash values (reorg scenario)', () => {
    const key1 = buildIdempotencyKey({ ...BASE, blockHash: '0x' + 'aa'.repeat(32) });
    const key2 = buildIdempotencyKey({ ...BASE, blockHash: '0x' + 'bb'.repeat(32) });
    expect(key1).not.toBe(key2);
  });

  it('normalizes mixed-case hex to lowercase', () => {
    const upper = buildIdempotencyKey({
      ...BASE,
      txHash: '0xAABBCCDD00000000000000000000000000000000000000000000000000000001',
      blockHash: '0xDEADBEEF00000000000000000000000000000000000000000000000000000002',
    });
    expect(upper).toBe(buildIdempotencyKey(BASE));
  });

  it('same (sourceType, chain, tx, logIndex) × two blockHashes → two distinct keys', () => {
    const a = buildIdempotencyKey({ ...BASE, blockHash: '0x' + '11'.repeat(32) });
    const b = buildIdempotencyKey({ ...BASE, blockHash: '0x' + '22'.repeat(32) });
    expect(a).not.toBe(b);
    expect(a.split(':').slice(0, 4)).toEqual(b.split(':').slice(0, 4));
  });

  it('different logIndex → different key', () => {
    expect(buildIdempotencyKey({ ...BASE, logIndex: 0 })).not.toBe(
      buildIdempotencyKey({ ...BASE, logIndex: 1 }),
    );
  });

  it('throws on missing 0x prefix', () => {
    expect(() => buildIdempotencyKey({ ...BASE, txHash: 'aabbcc' })).toThrow(/invalid hex/);
  });

  it('throws on odd-length hex', () => {
    expect(() => buildIdempotencyKey({ ...BASE, txHash: '0xabc' })).toThrow(/invalid hex/);
  });

  it('throws on empty sourceType', () => {
    expect(() => buildIdempotencyKey({ ...BASE, sourceType: '' })).toThrow(/sourceType/);
  });

  it('throws on negative chainId', () => {
    expect(() => buildIdempotencyKey({ ...BASE, chainId: -1 })).toThrow(/chainId/);
  });

  it('throws on negative logIndex', () => {
    expect(() => buildIdempotencyKey({ ...BASE, logIndex: -1 })).toThrow(/logIndex/);
  });
});
