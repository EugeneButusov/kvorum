import { describe, it, expect } from 'vitest';
import { DecodeError } from './decode-error';

const LOG_REF = { txHash: '0x' + 'ab'.repeat(32), logIndex: 0, blockHash: '0x' + 'cd'.repeat(32) };

describe('DecodeError', () => {
  it('sets name, message, and reason', () => {
    const err = new DecodeError('unknown_topic', { raw: 'data' }, LOG_REF);
    expect(err.name).toBe('DecodeError');
    expect(err.message).toBe('decode failed: unknown_topic');
    expect(err.reason).toBe('unknown_topic');
  });

  it('is instanceof Error and instanceof DecodeError', () => {
    const err = new DecodeError('parse_failed', null, LOG_REF);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DecodeError);
  });

  it('exposes decodeSource and logRef', () => {
    const src = { topics: ['0xabc'] };
    const err = new DecodeError('wrong_address', src, LOG_REF);
    expect(err.decodeSource).toBe(src);
    expect(err.logRef).toBe(LOG_REF);
  });
});
