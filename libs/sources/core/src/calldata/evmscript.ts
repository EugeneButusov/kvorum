/**
 * CallsScript (spec 1) decoder — protocol-agnostic Aragon EVMScript parser.
 *
 * ## Wire format (spec_id = 0x00000001)
 *
 *   0x00000001               4 bytes — spec id
 *   repeated until end:
 *     to              20 bytes — call target address
 *     calldataLength   4 bytes — uint32 big-endian; length of the FULL following calldata
 *     calldata         N bytes — complete calldata INCLUDING the 4-byte selector
 *
 * No value field; every leaf call executes with msg.value = 0.
 * Only Agent.execute(_target, _ethValue, _data) can carry non-zero ETH (see @sources/lido forwarder layer).
 *
 * ## Structural-parse metric
 * The ≥95% acceptance criterion on historical Lido votes measures structural-parse success
 * over non-empty executionScripts only. It is independent of inner-calldata ABI resolution
 * (§3.8). Empty scripts parse to [] and are counted separately.
 *
 * ## Forwarder recursion
 * This parser is flat — it returns one EvmScriptCall per inner call without recursing into
 * nested EVMScripts. The Lido-specific forwarder layer (@sources/lido/calldata/forwarders)
 * recurses Agent.forward / Agent.execute calls. This is a deliberate divergence from Lido's
 * own evm-script-decoder (a display tool that does not recurse); here we want flattened
 * proposal_action leaves.
 */

export interface EvmScriptCall {
  /** Lowercase 0x-prefixed 20-byte address. */
  to: string;
  /** Complete calldata including the 4-byte selector, as 0x-prefixed hex. */
  calldata: string;
}

export type EvmScriptDecodeErrorReason = 'not_hex' | 'unsupported_spec_id' | 'truncated';

export class EvmScriptDecodeError extends Error {
  constructor(
    public readonly reason: EvmScriptDecodeErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'EvmScriptDecodeError';
  }
}

const SPEC_ID = '00000001';
const SPEC_ID_BYTES = 4;
const ADDRESS_BYTES = 20;
const LENGTH_BYTES = 4;

/**
 * Decode a CallsScript (spec 1) hex string into an ordered list of calls.
 *
 * - Empty string `''` or bare spec-id `'0x00000001'` → `[]`
 * - Non-hex or odd-length → throws `EvmScriptDecodeError('not_hex')`
 * - Spec id ≠ 0x00000001 → throws `EvmScriptDecodeError('unsupported_spec_id')`
 * - Length prefix overruns remaining bytes → throws `EvmScriptDecodeError('truncated')`
 */
export function decodeEvmScript(scriptHex: string): EvmScriptCall[] {
  const raw = scriptHex.startsWith('0x') ? scriptHex.slice(2) : scriptHex;

  if (raw === '') return [];

  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length % 2 !== 0) {
    throw new EvmScriptDecodeError('not_hex', `Invalid hex string: ${scriptHex.slice(0, 20)}…`);
  }

  const bytes = Buffer.from(raw, 'hex');

  if (bytes.length < SPEC_ID_BYTES) {
    throw new EvmScriptDecodeError('truncated', 'Script too short to contain spec id');
  }

  const specId = bytes.subarray(0, SPEC_ID_BYTES).toString('hex');
  if (specId !== SPEC_ID) {
    throw new EvmScriptDecodeError(
      'unsupported_spec_id',
      `Unsupported spec id: 0x${specId} (expected 0x${SPEC_ID})`,
    );
  }

  if (bytes.length === SPEC_ID_BYTES) return [];

  const calls: EvmScriptCall[] = [];
  let offset = SPEC_ID_BYTES;

  while (offset < bytes.length) {
    if (offset + ADDRESS_BYTES + LENGTH_BYTES > bytes.length) {
      throw new EvmScriptDecodeError(
        'truncated',
        `Truncated at offset ${offset}: insufficient bytes for address + length prefix`,
      );
    }

    const to =
      '0x' +
      bytes
        .subarray(offset, offset + ADDRESS_BYTES)
        .toString('hex')
        .toLowerCase();
    offset += ADDRESS_BYTES;

    const calldataLength = bytes.readUInt32BE(offset);
    offset += LENGTH_BYTES;

    if (offset + calldataLength > bytes.length) {
      throw new EvmScriptDecodeError(
        'truncated',
        `Truncated at offset ${offset}: calldata length ${calldataLength} overruns remaining ${bytes.length - offset} bytes`,
      );
    }

    const calldata = '0x' + bytes.subarray(offset, offset + calldataLength).toString('hex');
    offset += calldataLength;

    calls.push({ to, calldata });
  }

  return calls;
}
