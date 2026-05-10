import { describe, expect, it } from 'vitest';
import { decodeHead, decodeLogEvent } from './decode.utils.js';

const CHAIN_ID = 31337;
const SOURCE_TYPE = 'compound_governor';

function makeRawLog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    blockNumber: '0xa',
    blockHash: '0x' + 'cd'.repeat(32),
    transactionHash: '0x' + 'ab'.repeat(32),
    transactionIndex: '0x0',
    logIndex: '0x2',
    address: '0x' + 'aa'.repeat(20),
    topics: ['0xDEADBEEF'],
    data: '0x',
    ...overrides,
  };
}

function makeRawBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: '0x10',
    hash: '0x' + 'cd'.repeat(32),
    parentHash: '0x' + 'aa'.repeat(32),
    timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16),
    ...overrides,
  };
}

describe('decodeLogEvent', () => {
  it('normalises a happy-path log', () => {
    const out = decodeLogEvent(makeRawLog(), SOURCE_TYPE, CHAIN_ID);
    expect(out.sourceType).toBe(SOURCE_TYPE);
    expect(out.chainId).toBe(CHAIN_ID);
    expect(out.blockNumber).toBe(10n);
    expect(out.txIndex).toBe(0);
    expect(out.logIndex).toBe(2);
    expect(out.topics).toEqual(['0xdeadbeef']);
    expect(out.address).toBe('0x' + 'aa'.repeat(20));
  });

  it('lowercases mixed-case hashes and address', () => {
    const out = decodeLogEvent(
      makeRawLog({
        address: '0xAABBCC' + 'aa'.repeat(17),
        blockHash: '0x' + 'CD'.repeat(32),
      }),
      SOURCE_TYPE,
      CHAIN_ID,
    );
    expect(out.address).toMatch(/^0x[0-9a-f]+$/);
    expect(out.blockHash).toBe('0x' + 'cd'.repeat(32));
  });

  it('treats missing topics as empty array', () => {
    const raw = makeRawLog();
    delete raw['topics'];
    const out = decodeLogEvent(raw, SOURCE_TYPE, CHAIN_ID);
    expect(out.topics).toEqual([]);
  });

  it('accepts empty data ("0x")', () => {
    const out = decodeLogEvent(makeRawLog({ data: '0x' }), SOURCE_TYPE, CHAIN_ID);
    expect(out.data).toBe('0x');
  });

  it('throws when blockNumber is missing', () => {
    expect(() => decodeLogEvent(makeRawLog({ blockNumber: null }), SOURCE_TYPE, CHAIN_ID)).toThrow(
      /blockNumber/,
    );
  });

  it('throws when topics is not an array', () => {
    expect(() =>
      decodeLogEvent(makeRawLog({ topics: 'not-an-array' }), SOURCE_TYPE, CHAIN_ID),
    ).toThrow(/topics must be an array/);
  });

  it('throws when a topic entry is non-hex', () => {
    expect(() => decodeLogEvent(makeRawLog({ topics: ['oops'] }), SOURCE_TYPE, CHAIN_ID)).toThrow(
      /topics\[0\]/,
    );
  });

  it('throws when transactionIndex is unparseable', () => {
    expect(() =>
      decodeLogEvent(makeRawLog({ transactionIndex: 'nope' }), SOURCE_TYPE, CHAIN_ID),
    ).toThrow(/transactionIndex/);
  });
});

describe('decodeHead', () => {
  const now = new Date('2026-05-10T00:00:00Z');

  it('normalises a happy-path block', () => {
    const out = decodeHead(makeRawBlock(), CHAIN_ID, now);
    expect(out.chainId).toBe(CHAIN_ID);
    expect(out.blockNumber).toBe(16n);
    expect(out.observedAt).toBe(now);
  });

  it('lowercases hash and parentHash', () => {
    const out = decodeHead(
      makeRawBlock({ hash: '0x' + 'CD'.repeat(32), parentHash: '0x' + 'AA'.repeat(32) }),
      CHAIN_ID,
      now,
    );
    expect(out.blockHash).toBe('0x' + 'cd'.repeat(32));
    expect(out.parentHash).toBe('0x' + 'aa'.repeat(32));
  });

  it('parses timestamp as bigint', () => {
    const out = decodeHead(makeRawBlock({ timestamp: '0x64' }), CHAIN_ID, now);
    expect(out.timestamp).toBe(100n);
  });

  it('rejects non-object response', () => {
    expect(() => decodeHead(null, CHAIN_ID, now)).toThrow(/not an object/);
    expect(() => decodeHead('latest', CHAIN_ID, now)).toThrow(/not an object/);
  });

  it('throws when hash is missing', () => {
    expect(() => decodeHead(makeRawBlock({ hash: null }), CHAIN_ID, now)).toThrow(/hash/);
  });

  it('throws when parentHash is missing', () => {
    expect(() => decodeHead(makeRawBlock({ parentHash: null }), CHAIN_ID, now)).toThrow(
      /parentHash/,
    );
  });

  it('throws when timestamp is missing', () => {
    expect(() => decodeHead(makeRawBlock({ timestamp: null }), CHAIN_ID, now)).toThrow(/timestamp/);
  });

  it('throws when number is missing', () => {
    expect(() => decodeHead(makeRawBlock({ number: null }), CHAIN_ID, now)).toThrow(/number/);
  });
});
