import type { RpcClient } from '../client/rpc-client.js';
import type { Logger } from '../logger.js';

export type BufferResetReason = 'cold_start' | 'gap_exceeded_horizon';

export interface ReorgSignal {
  chainId: string;
  /** Signal-emission time (post re-fetch). */
  detectedAt: Date;
  /** The triggering head's observedAt — closer to actual chain observation than detectedAt. */
  observedAt: Date;
  /** Lowest block number where canonical diverges from buffered. When `truncated`, this is
   *  the oldest buffered block — divergence may extend further back. */
  divergenceBlockNumber: bigint;
  /** Hashes previously buffered for [divergenceBlock, lastObservedHead], in order.
   *  Entries are `null` for blocks within the range with no buffered hash — this happens
   *  when `truncated` is true and divergence extends below the oldest buffered block.
   *  Consumers must treat `null` as "unknown orphan", not as zero. */
  orphanedBlockHashes: (string | null)[];
  /** Re-fetched canonical hashes for the same range, in order. Same length as
   *  orphanedBlockHashes. For chain-shrink reorgs, trailing entries are `null`. */
  canonicalBlockHashes: (string | null)[];
  /** True iff reorg extends to or past the oldest buffered block — detector can't guarantee
   *  divergencePoint is the true root. F2 alerts. */
  truncated: boolean;
  /** True iff the new chain is shorter than the orphaned chain (head went backwards or some
   *  canonical blocks no longer exist). */
  chainShrunk: boolean;
}

export interface BufferResetSignal {
  chainId: string;
  reason: BufferResetReason;
  atBlockNumber: bigint;
  occurredAt: Date;
}

export type ReorgListener = (signal: ReorgSignal) => void | Promise<void>;
export type BufferResetListener = (signal: BufferResetSignal) => void | Promise<void>;

export interface ReorgDetectorOptions {
  rpcClient: RpcClient;
  chainId: string;
  chainName: string;
  /** Window size; per SPEC §3.4 the window covers the reorg horizon. */
  reorgHorizon: number;
  logger?: Logger;
}
