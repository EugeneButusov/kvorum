import { dataSlice, getAddress, encodeBytes32String, decodeBytes32String } from 'ethers';

const ZERO_BYTES32 = '0x' + '0'.repeat(64);
const UPPER_12_BYTES_ZERO = '0x' + '0'.repeat(24);

/**
 * Decode a `bytes32` delegate id (Split Delegation) into a lowercase EVM address.
 *
 * EVM addresses are right-aligned in a 32-byte word (12 zero bytes then 20 address bytes). A
 * non-zero upper word means the id is a cross-chain / non-EVM delegate (Split Delegation uses
 * bytes32 ids for portability) — return null so the caller skips it rather than fabricating an
 * address from the wrong bytes.
 */
export function bytes32ToAddress(b32: string): string | null {
  const normalized = b32.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) return null;
  if (normalized.slice(0, 26) !== UPPER_12_BYTES_ZERO) return null; // upper 12 bytes must be zero
  return getAddress(dataSlice(normalized, 12)).toLowerCase();
}

/**
 * Decode a `bytes32` space id (Delegate Registry) into the Snapshot space name. The id is the
 * space name as ascii, right-zero-padded (`encodeBytes32String`). The all-zero id is the GLOBAL
 * delegation scope → null (applies to every space unless a space-specific delegation overrides it).
 */
export function decodeSpaceId(b32: string): string | null {
  const normalized = b32.toLowerCase();
  if (normalized === ZERO_BYTES32) return null; // global scope
  try {
    const decoded = decodeBytes32String(normalized);
    return decoded.length === 0 ? null : decoded;
  } catch {
    // Non-ascii / non-terminated id we can't interpret as a space name.
    return null;
  }
}

/** Encode a Snapshot space name into the `bytes32` id used as the Delegate Registry `SetDelegate.id` topic. */
export function encodeSpaceId(space: string): string {
  return encodeBytes32String(space).toLowerCase();
}

export const GLOBAL_SPACE_ID = ZERO_BYTES32;
