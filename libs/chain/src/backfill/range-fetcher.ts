import type { RpcClient } from '../client/rpc-client.js';
import type { Logger } from '../logger.js';
import { BackfillChunkTooSmallError } from './errors/backfill-chunk-too-small.error.js';
import { chainMetrics } from '../metrics/metrics.js';
import type { EventsListener, LogEvent, LogFilter } from '../poller/types.js';
import { decodeLogEvent } from '../poller/utils/decode.utils.js';
import { lowercaseFilter } from '../poller/utils/filter.utils.js';

export interface BackfillRangeFetcherOptions {
  rpcClient: RpcClient;
  filter: LogFilter;
  sourceType: string;
  chainId: string;
  sourceLabel: string;
  listener: EventsListener;
  fromBlock: bigint;
  toBlock: bigint;
  /** Default 10_000. Adaptive-shrink will reduce this on "too many results" errors. */
  chunkSize?: number;
  signal?: AbortSignal;
  logger?: Logger;
  /** Called after the listener resolves and before the gauge update.
   *  The driver uses this to checkpoint (updateBackfillHead) so a crash
   *  can resume from the last fully-landed chunk. */
  onChunkComplete?: (chunkEnd: bigint) => Promise<void>;
}

export type BackfillRangeFetcherResult =
  | { completed: true }
  | { cancelled: true; lastCompletedBlock: bigint | null };

const DEFAULT_CHUNK_SIZE = 10_000;
const CHUNK_FLOOR = 1_000;

/** Returns true if the eth_getLogs error signals that the result set is too large. */
export function isTooManyResults(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;

  // Structured JSON-RPC error code -32005 (wrapped by ethers v6 as UNKNOWN_ERROR)
  const inner = e['error'] as Record<string, unknown> | undefined;
  if (typeof inner?.['code'] === 'number' && inner['code'] === -32005) return true;

  const ALLOWLIST = ['too many results', 'response size exceeded', 'query returned more than'];
  const msgLower = (typeof e['message'] === 'string' ? e['message'] : '').toLowerCase();
  const innerMsgLower = (
    typeof inner?.['message'] === 'string' ? (inner['message'] as string) : ''
  ).toLowerCase();
  return ALLOWLIST.some((s) => msgLower.includes(s) || innerMsgLower.includes(s));
}

/** Finite, chunked eth_getLogs fetcher with adaptive chunk-size shrink and AbortSignal support.
 *
 *  Does no DB writes itself — it fetches, decodes, and dispatches to the injected listener.
 *  Checkpointing is the caller's responsibility via `onChunkComplete`. */
export class BackfillRangeFetcher {
  private readonly filter: LogFilter;

  constructor(private readonly opts: BackfillRangeFetcherOptions) {
    this.filter = Object.freeze(lowercaseFilter(opts.filter));
  }

  async run(): Promise<BackfillRangeFetcherResult> {
    const {
      rpcClient,
      sourceType,
      chainId,
      sourceLabel,
      listener,
      fromBlock,
      toBlock,
      signal,
      logger,
      onChunkComplete,
    } = this.opts;

    let chunkSz = this.opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
    let current = fromBlock;
    let lastCompletedBlock: bigint | null = null;

    while (current <= toBlock) {
      // Check abort signal at chunk boundary before fetching
      if (signal?.aborted) {
        return { cancelled: true, lastCompletedBlock };
      }

      let chunkEnd = this.chunkEnd(current, chunkSz, toBlock);

      // Fetch with adaptive shrink on "too many results"
      let rawLogs: unknown[];
      for (;;) {
        try {
          rawLogs = await rpcClient.send<unknown[]>('eth_getLogs', [
            {
              fromBlock: '0x' + current.toString(16),
              toBlock: '0x' + chunkEnd.toString(16),
              address: this.filter.address,
              topics: this.filter.topics,
            },
          ]);
          break;
        } catch (err) {
          if (!isTooManyResults(err)) throw err;
          if (chunkSz <= CHUNK_FLOOR) throw new BackfillChunkTooSmallError(current, chunkEnd);
          chunkSz = Math.max(CHUNK_FLOOR, Math.floor(chunkSz / 2));
          chunkEnd = this.chunkEnd(current, chunkSz, toBlock);
          logger?.warn(
            `[backfill][source:${sourceLabel}] too many results; shrinking chunk to ${chunkSz} blocks`,
          );
        }
      }

      // Decode and dispatch
      const events: LogEvent[] = [];
      for (const raw of rawLogs!) {
        try {
          events.push(decodeLogEvent(raw as Record<string, unknown>, sourceType, chainId));
        } catch (err) {
          logger?.error(`[backfill][source:${sourceLabel}] dropping malformed log: ${String(err)}`);
        }
      }

      chainMetrics.logsFetched.add(events.length, { chain: chainId, dao_source: sourceLabel });

      if (events.length > 0) await listener(events);

      // Checkpoint hook (driver commits updateBackfillHead before the gauge)
      await onChunkComplete?.(chunkEnd);

      // Gauge advances after checkpoint so a crash-resume reads an accurate last block
      chainMetrics.backfillProgressBlock.record(Number(chunkEnd), { source: sourceLabel });

      lastCompletedBlock = chunkEnd;
      current = chunkEnd + 1n;
    }

    return { completed: true };
  }

  private chunkEnd(from: bigint, size: number, max: bigint): bigint {
    const end = from + BigInt(size) - 1n;
    return end < max ? end : max;
  }
}
