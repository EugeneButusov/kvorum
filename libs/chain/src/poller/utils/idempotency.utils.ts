import { normalizeEvenLengthHex } from './hex.utils.js';

/** Canonicalizes case and returns `${sourceType}:${chainId}:${txHash}:${logIndex}:${blockHash}`.
 *
 *  The 4-tuple matches the PG `archive_event_idempotency_key` unique constraint.
 *  Hex inputs are validated (0x prefix, even length, hex chars); throws on malformed input. */
export function buildIdempotencyKey(parts: {
  sourceType: string;
  chainId: string;
  txHash: string;
  logIndex: number;
  blockHash: string;
}): string {
  const { sourceType, chainId, txHash, logIndex, blockHash } = parts;
  if (!sourceType || typeof sourceType !== 'string') {
    throw new Error('buildIdempotencyKey: sourceType must be a non-empty string');
  }
  if (!chainId || typeof chainId !== 'string') {
    throw new Error('buildIdempotencyKey: chainId must be a non-empty string');
  }
  if (!Number.isInteger(logIndex) || logIndex < 0) {
    throw new Error('buildIdempotencyKey: logIndex must be a non-negative integer');
  }
  const tx = normalizeEvenLengthHex(txHash, 'txHash');
  const bh = normalizeEvenLengthHex(blockHash, 'blockHash');
  return `${sourceType}:${chainId}:${tx}:${logIndex}:${bh}`;
}
