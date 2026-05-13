import { describe, expect, it } from 'vitest';
import { decodeCompoundLog } from '@sources/compound';
import { COMPOUND_EVENT_TOPICS } from '@sources/compound';
import { DecodeError } from '@sources/compound';

/**
 * Ethers-version skew guard for the malformed emitter bytecode.
 *
 * The 8-byte data sequence emitted by CompoundEmitter.emitMalformed() must cause
 * decodeCompoundLog to throw DecodeError(reason='parse_failed'). If a future ethers
 * minor-version change allows silent partial decoding of a truncated buffer, this test
 * will break loudly BEFORE the F3b integration test could silently pass for the wrong
 * reason.
 */
describe('malformed-emitter skew guard', () => {
  it('decodeCompoundLog throws DecodeError(parse_failed) on the 8-byte truncated payload', () => {
    const fakeLog = {
      sourceType: 'compound_governor',
      chainId: '0x7a69',
      topics: [COMPOUND_EVENT_TOPICS.ProposalCreated],
      data: '0x0000000000000000', // 8 bytes — emitMalformed() emits exactly these
      txHash: '0x' + 'aa'.repeat(32),
      txIndex: 0,
      logIndex: 0,
      blockHash: '0x' + 'bb'.repeat(32),
      blockNumber: 1n,
      address: '0x' + '00'.repeat(20),
    };

    expect(() => decodeCompoundLog(fakeLog)).toThrow(DecodeError);

    let caught: unknown;
    try {
      decodeCompoundLog(fakeLog);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DecodeError);
    expect((caught as DecodeError).reason).toBe('parse_failed');
  });
});
