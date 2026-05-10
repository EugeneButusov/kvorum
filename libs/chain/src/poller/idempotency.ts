const HEX_RE = /^0x[0-9a-f]*$/;

function normalizeHex(value: string, field: string): string {
  const lower = value.toLowerCase();
  if (!HEX_RE.test(lower) || lower.length < 3 || (lower.length - 2) % 2 !== 0) {
    throw new Error(
      `buildIdempotencyKey: invalid hex for ${field}: "${value}" — expected 0x-prefixed even-length hex`,
    );
  }
  return lower;
}

/** Canonicalizes case and returns `${sourceType}:${chainId}:${txHash}:${logIndex}:${blockHash}`.
 *
 *  The 5-tuple matches the PG `archive_confirmation_idempotency_key` unique constraint.
 *  Hex inputs are validated (0x prefix, even length, hex chars); throws on malformed input. */
export function buildIdempotencyKey(parts: {
  sourceType: string;
  chainId: number;
  txHash: string;
  logIndex: number;
  blockHash: string;
}): string {
  const { sourceType, chainId, txHash, logIndex, blockHash } = parts;
  if (!sourceType || typeof sourceType !== 'string') {
    throw new Error('buildIdempotencyKey: sourceType must be a non-empty string');
  }
  if (!Number.isInteger(chainId) || chainId < 0) {
    throw new Error('buildIdempotencyKey: chainId must be a non-negative integer');
  }
  if (!Number.isInteger(logIndex) || logIndex < 0) {
    throw new Error('buildIdempotencyKey: logIndex must be a non-negative integer');
  }
  const tx = normalizeHex(txHash, 'txHash');
  const bh = normalizeHex(blockHash, 'blockHash');
  return `${sourceType}:${chainId}:${tx}:${logIndex}:${bh}`;
}
