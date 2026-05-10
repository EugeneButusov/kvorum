const HEX_RE = /^0x[0-9a-fA-F]*$/i;

/** Validates that value is a `0x`-prefixed hex string. Accepts empty hex (`'0x'`).
 *  Used to gate per-field decoding in EventPoller/HeadTracker; throws on the first
 *  malformed field so the caller can drop the whole record. */
export function requireHexString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HEX_RE.test(value)) {
    throw new Error(`missing or non-hex ${field}`);
  }
  return value;
}

/** Coerces a hex string (e.g. `'0x1a'`) or number to a non-negative integer. */
export function requireNonNegativeInt(value: unknown, field: string): number {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`missing or invalid ${field}`);
  }
  return n;
}

/** Stricter than `requireHexString`: requires non-empty body and even-length hex.
 *  Returns the lowercased canonical form. Used by `buildIdempotencyKey` where the
 *  inputs are 32-byte hashes — empty or odd-length hex is always a caller bug. */
export function normalizeEvenLengthHex(value: string, field: string): string {
  const lower = value.toLowerCase();
  if (!HEX_RE.test(lower) || lower.length < 3 || (lower.length - 2) % 2 !== 0) {
    throw new Error(`invalid hex for ${field}: "${value}" — expected 0x-prefixed even-length hex`);
  }
  return lower;
}
