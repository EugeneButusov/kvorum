import { describe, expect, it } from 'vitest';
import { GLOBAL_SPACE_ID, bytes32ToAddress, decodeSpaceId, encodeSpaceId } from './address';

const ADDR = `0x${'ab'.repeat(20)}`;

describe('bytes32ToAddress', () => {
  it('decodes a left-zero-padded EVM address (lower 20 bytes)', () => {
    const b32 = `0x${'00'.repeat(12)}${'ab'.repeat(20)}`;
    expect(bytes32ToAddress(b32)).toBe(ADDR);
  });

  it('is case-insensitive on input', () => {
    const b32 = `0x${'00'.repeat(12)}${'AB'.repeat(20)}`;
    expect(bytes32ToAddress(b32)).toBe(ADDR);
  });

  it('returns null when the upper 12 bytes are non-zero (cross-chain id)', () => {
    const b32 = `0x${'11'}${'00'.repeat(11)}${'ab'.repeat(20)}`;
    expect(bytes32ToAddress(b32)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(bytes32ToAddress('0xnothex')).toBeNull();
    expect(bytes32ToAddress(`0x${'ab'.repeat(10)}`)).toBeNull();
  });

  it('decodes the zero id to the zero address', () => {
    expect(bytes32ToAddress(GLOBAL_SPACE_ID)).toBe(`0x${'00'.repeat(20)}`);
  });
});

describe('decodeSpaceId / encodeSpaceId', () => {
  it('round-trips a space name', () => {
    expect(decodeSpaceId(encodeSpaceId('lido-snapshot.eth'))).toBe('lido-snapshot.eth');
    expect(decodeSpaceId(encodeSpaceId('aavedao.eth'))).toBe('aavedao.eth');
  });

  it('maps the zero id to global (null)', () => {
    expect(decodeSpaceId(GLOBAL_SPACE_ID)).toBeNull();
  });

  it('returns null for an undecodable id', () => {
    // A high byte in the first position is not valid encodeBytes32String output.
    expect(decodeSpaceId(`0x${'ff'.repeat(32)}`)).toBeNull();
  });

  it('encodeSpaceId yields a 32-byte hex string', () => {
    expect(encodeSpaceId('lido-snapshot.eth')).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
