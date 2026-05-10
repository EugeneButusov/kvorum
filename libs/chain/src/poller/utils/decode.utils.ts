import type { Head, LogEvent } from '../types.js';
import { requireHexString, requireNonNegativeInt } from './hex.utils.js';

/** Decodes a raw `eth_getLogs` entry into a normalised `LogEvent`. Every field is
 *  validated; throws on the first malformed field. Address/hashes are lowercased. */
export function decodeLogEvent(
  log: Record<string, unknown>,
  sourceType: string,
  chainId: number,
): LogEvent {
  const blockNumberHex = requireHexString(log['blockNumber'], 'blockNumber');
  const blockHash = requireHexString(log['blockHash'], 'blockHash').toLowerCase();
  const txHash = requireHexString(log['transactionHash'], 'transactionHash').toLowerCase();
  const txIndex = requireNonNegativeInt(log['transactionIndex'], 'transactionIndex');
  const logIndex = requireNonNegativeInt(log['logIndex'], 'logIndex');
  const address = requireHexString(log['address'], 'address').toLowerCase();
  const data = requireHexString(log['data'], 'data');
  const rawTopics = log['topics'];
  if (rawTopics != null && !Array.isArray(rawTopics)) {
    throw new Error('topics must be an array');
  }
  const topics = ((rawTopics as string[] | undefined) ?? []).map((t, i) =>
    requireHexString(t, `topics[${i}]`).toLowerCase(),
  );
  return {
    sourceType,
    chainId,
    blockNumber: BigInt(blockNumberHex),
    blockHash,
    txHash,
    txIndex,
    logIndex,
    address,
    topics,
    data,
  };
}

/** Decodes a raw `eth_getBlockByNumber` result into a normalised `Head`.
 *  Throws on a non-object response or any missing/non-hex field. */
export function decodeHead(raw: unknown, chainId: number, observedAt: Date): Head {
  if (!raw || typeof raw !== 'object') {
    throw new Error('block response is not an object');
  }
  const block = raw as Record<string, unknown>;
  return {
    chainId,
    blockNumber: BigInt(requireHexString(block['number'], 'number')),
    blockHash: requireHexString(block['hash'], 'hash').toLowerCase(),
    parentHash: requireHexString(block['parentHash'], 'parentHash').toLowerCase(),
    timestamp: BigInt(requireHexString(block['timestamp'], 'timestamp')),
    observedAt,
  };
}
