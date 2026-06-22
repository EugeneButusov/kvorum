import { describe, it, expect } from 'vitest';
import { decodeEvmScript, EvmScriptDecodeError } from './evmscript';

/**
 * Helpers to build minimal hand-crafted CallsScript byte vectors.
 * spec_id (4 bytes) + repeated [to(20) + len(uint32 BE, 4) + calldata(len)]
 */
function buildScript(calls: Array<{ to: string; calldata: string }>): string {
  const parts: Buffer[] = [Buffer.from('00000001', 'hex')];
  for (const { to, calldata } of calls) {
    const toBytes = Buffer.from(to.replace('0x', ''), 'hex');
    const cdBytes = Buffer.from(calldata.replace('0x', ''), 'hex');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(cdBytes.length, 0);
    parts.push(toBytes, lenBuf, cdBytes);
  }
  return '0x' + Buffer.concat(parts).toString('hex');
}

const ADDR_A = '0x' + 'aa'.repeat(20);
const ADDR_B = '0x' + 'bb'.repeat(20);
const ADDR_C = '0x' + 'cc'.repeat(20);
const CD_4 = '0x12345678'; // 4-byte selector only
const CD_8 = '0x1234567890abcdef'; // selector + 4 bytes args

describe('decodeEvmScript', () => {
  it('empty string returns []', () => {
    expect(decodeEvmScript('')).toEqual([]);
    expect(decodeEvmScript('0x')).toEqual([]);
  });

  it('bare spec id returns []', () => {
    expect(decodeEvmScript('0x00000001')).toEqual([]);
    expect(decodeEvmScript('00000001')).toEqual([]);
  });

  it('single call — exact address and calldata extraction', () => {
    const script = buildScript([{ to: ADDR_A, calldata: CD_4 }]);
    const calls = decodeEvmScript(script);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ to: ADDR_A, calldata: CD_4 });
  });

  it('multi-call — preserves order', () => {
    const script = buildScript([
      { to: ADDR_A, calldata: CD_4 },
      { to: ADDR_B, calldata: CD_8 },
      { to: ADDR_C, calldata: CD_4 },
    ]);
    const calls = decodeEvmScript(script);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.to).toBe(ADDR_A);
    expect(calls[1]?.to).toBe(ADDR_B);
    expect(calls[2]?.to).toBe(ADDR_C);
  });

  it('lowercases address', () => {
    const mixedCase = '0x' + 'Ab'.repeat(20);
    const script = buildScript([{ to: mixedCase, calldata: CD_4 }]);
    const calls = decodeEvmScript(script);
    expect(calls[0]?.to).toBe('0x' + 'ab'.repeat(20));
  });

  it('keeps full calldata including selector', () => {
    const script = buildScript([{ to: ADDR_A, calldata: CD_8 }]);
    const calls = decodeEvmScript(script);
    expect(calls[0]?.calldata).toBe(CD_8);
  });

  it('zero-length calldata is valid', () => {
    const script = buildScript([{ to: ADDR_A, calldata: '0x' }]);
    const calls = decodeEvmScript(script);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.calldata).toBe('0x');
  });

  it('works without 0x prefix', () => {
    const script = buildScript([{ to: ADDR_A, calldata: CD_4 }]);
    const noPrefixScript = script.slice(2); // strip 0x
    const calls = decodeEvmScript(noPrefixScript);
    expect(calls).toHaveLength(1);
  });

  it('determinism: same input twice → deep-equal', () => {
    const script = buildScript([
      { to: ADDR_A, calldata: CD_4 },
      { to: ADDR_B, calldata: CD_8 },
    ]);
    const first = decodeEvmScript(script);
    const second = decodeEvmScript(script);
    expect(first).toEqual(second);
  });

  describe('errors', () => {
    it('odd-length hex → not_hex', () => {
      expect(() => decodeEvmScript('0x000')).toThrow(EvmScriptDecodeError);
      try {
        decodeEvmScript('0x000');
      } catch (e) {
        expect(e).toBeInstanceOf(EvmScriptDecodeError);
        expect((e as EvmScriptDecodeError).reason).toBe('not_hex');
      }
    });

    it('non-hex chars → not_hex', () => {
      expect(() => decodeEvmScript('0xGGGGGGGG')).toThrow(EvmScriptDecodeError);
      try {
        decodeEvmScript('0xGGGGGGGG');
      } catch (e) {
        expect((e as EvmScriptDecodeError).reason).toBe('not_hex');
      }
    });

    it('wrong spec id 0x00000002 → unsupported_spec_id', () => {
      try {
        decodeEvmScript('0x' + '00000002' + 'aa'.repeat(24));
      } catch (e) {
        expect(e).toBeInstanceOf(EvmScriptDecodeError);
        expect((e as EvmScriptDecodeError).reason).toBe('unsupported_spec_id');
      }
    });

    it('spec id 0x00000003 → unsupported_spec_id', () => {
      try {
        decodeEvmScript('0x00000003');
      } catch (e) {
        expect((e as EvmScriptDecodeError).reason).toBe('unsupported_spec_id');
      }
    });

    it('spec id 0x00000004 → unsupported_spec_id', () => {
      try {
        decodeEvmScript('0x00000004');
      } catch (e) {
        expect((e as EvmScriptDecodeError).reason).toBe('unsupported_spec_id');
      }
    });

    it('spec id + stray byte (only 1 byte of an address) → truncated', () => {
      // spec id (4) + 1 byte = not enough for address (20) + length prefix (4)
      const script = '0x' + '00000001' + 'aa';
      try {
        decodeEvmScript(script);
      } catch (e) {
        expect(e).toBeInstanceOf(EvmScriptDecodeError);
        expect((e as EvmScriptDecodeError).reason).toBe('truncated');
      }
    });

    it('truncated length prefix (address ok, only 2 of 4 length bytes) → truncated', () => {
      // spec id (4) + address (20) + 2 bytes = truncated before length prefix done
      const raw = '00000001' + 'aa'.repeat(20) + 'aabb';
      try {
        decodeEvmScript('0x' + raw);
      } catch (e) {
        expect((e as EvmScriptDecodeError).reason).toBe('truncated');
      }
    });

    it('calldata length overruns remaining bytes → truncated', () => {
      // Manually craft: spec id + to(20) + calldataLength(4 bytes = 100) but only 4 bytes follow
      const buf = Buffer.alloc(4 + 20 + 4 + 4);
      buf.write('00000001', 0, 'hex');
      buf.fill(0xaa, 4, 24); // to
      buf.writeUInt32BE(100, 24); // length = 100 but...
      buf.fill(0xbb, 28, 32); // only 4 bytes of calldata follow
      try {
        decodeEvmScript('0x' + buf.toString('hex'));
      } catch (e) {
        expect(e).toBeInstanceOf(EvmScriptDecodeError);
        expect((e as EvmScriptDecodeError).reason).toBe('truncated');
      }
    });
  });
});
