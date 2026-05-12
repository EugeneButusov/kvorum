import type { RpcClient } from '../client/rpc-client.js';
import { silentLogger } from '../logger.js';
import type { Logger } from '../logger.js';
import type {
  ReorgSignal,
  BufferResetSignal,
  ReorgListener,
  BufferResetListener,
  ReorgDetectorOptions,
} from './types.js';
import { chainMetrics } from '../metrics/metrics.js';
import type { HeadTracker } from '../poller/head-tracker.js';
import type { Head } from '../poller/types.js';

interface BlockHeader {
  hash: string;
  parentHash: string;
}

export class ReorgDetector {
  private readonly rpcClient: RpcClient;
  private readonly chainId: string;
  private readonly chainName: string;
  private readonly reorgHorizon: number;
  private readonly logger: Logger;

  /** blockNumber → lowercased blockHash, bounded to reorgHorizon + 1 entries. */
  private readonly buffer: Map<bigint, string> = new Map();
  private lastHead: Head | null = null;

  private readonly reorgListeners: ReorgListener[] = [];
  private readonly resetListeners: BufferResetListener[] = [];

  constructor(opts: ReorgDetectorOptions) {
    this.rpcClient = opts.rpcClient;
    this.chainId = opts.chainId;
    this.chainName = opts.chainName;
    this.reorgHorizon = opts.reorgHorizon;
    this.logger = opts.logger ?? silentLogger;
  }

  onReorg(listener: ReorgListener): () => void {
    this.reorgListeners.push(listener);
    return () => {
      const i = this.reorgListeners.indexOf(listener);
      if (i >= 0) this.reorgListeners.splice(i, 1);
    };
  }

  onBufferReset(listener: BufferResetListener): () => void {
    this.resetListeners.push(listener);
    return () => {
      const i = this.resetListeners.indexOf(listener);
      if (i >= 0) this.resetListeners.splice(i, 1);
    };
  }

  /** Registers processHead as a HeadTracker listener. Returns the unsubscribe function. */
  attach(tracker: HeadTracker): () => void {
    return tracker.onHead((h) => this.processHead(h));
  }

  /** Number of entries currently in the sliding-window buffer. Useful for tests and
   *  for surfacing as a Prometheus gauge in a future iteration. */
  get bufferSize(): number {
    return this.buffer.size;
  }

  /** Testable primitive — can also be driven directly by backfill harnesses. */
  async processHead(h: Head): Promise<void> {
    const blockHash = h.blockHash.toLowerCase();
    const parentHash = h.parentHash.toLowerCase();
    const head: Head = { ...h, blockHash, parentHash };

    // Case 0: first head observed
    if (this.lastHead === null) {
      this.bufferSet(head.blockNumber, head.blockHash);
      // Back-fill up to reorgHorizon predecessors so reorgs that hit deep history
      // immediately after cold-start can be pinpointed instead of collapsing onto N.
      // Walks backward verifying parent linkage; stops gracefully on RPC error,
      // missing block, mismatch, or genesis. A partial buffer is acceptable —
      // worst case we degrade to the pre-back-fill behavior.
      await this.backfillBuffer(head);
      this.lastHead = head;
      await this.emitBufferReset({
        chainId: this.chainId,
        reason: 'cold_start',
        atBlockNumber: head.blockNumber,
        occurredAt: head.observedAt,
      });
      return;
    }

    // Case 1: same tip — no-op
    if (
      head.blockNumber === this.lastHead.blockNumber &&
      head.blockHash === this.lastHead.blockHash
    ) {
      return;
    }

    // Case 2: same height, different hash → reorg
    if (
      head.blockNumber === this.lastHead.blockNumber &&
      head.blockHash !== this.lastHead.blockHash
    ) {
      await this.runReorgPath(head, head.blockNumber, head.blockNumber);
      return;
    }

    // Case 3: head went backwards
    if (head.blockNumber < this.lastHead.blockNumber) {
      const bufferedAtNew = this.buffer.get(head.blockNumber);
      if (bufferedAtNew !== undefined && bufferedAtNew === head.blockHash) {
        // Case 3a: buffer at h.blockNumber matches — divergence is at h.blockNumber + 1
        await this.runReorgPath(head, head.blockNumber + 1n, this.lastHead.blockNumber, true);
      } else {
        // Case 3b: buffer differs or absent — divergence is at or below h.blockNumber
        await this.runReorgPath(head, head.blockNumber, this.lastHead.blockNumber, true);
      }
      return;
    }

    // Case 4: clean advance (head.blockNumber > lastHead.blockNumber)
    const prevBlockNumber = head.blockNumber - 1n;
    const bufferedAtPrev = this.buffer.get(prevBlockNumber);

    if (bufferedAtPrev !== undefined) {
      // Case 4c: buffer has entry at h.blockNumber - 1
      if (bufferedAtPrev === head.parentHash) {
        this.bufferSet(head.blockNumber, head.blockHash);
        this.lastHead = head;
      } else {
        const oldest = this.getOldestBufferedBlock() ?? prevBlockNumber;
        await this.runReorgPath(head, oldest, prevBlockNumber);
      }
      return;
    }

    // No buffer entry at h.blockNumber - 1 — check for gap
    const lastBuffered = this.getNewestBufferedBlock();

    if (lastBuffered === null || lastBuffered < head.blockNumber - BigInt(this.reorgHorizon)) {
      // Case 4b: gap exceeds horizon
      this.buffer.clear();
      this.bufferSet(head.blockNumber, head.blockHash);
      this.lastHead = head;
      await this.emitBufferReset({
        chainId: this.chainId,
        reason: 'gap_exceeded_horizon',
        atBlockNumber: head.blockNumber,
        occurredAt: head.observedAt,
      });
      return;
    }

    // Case 4a: gap within horizon — re-validate the most recently buffered block
    let canonicalLast: BlockHeader | null;
    try {
      canonicalLast = await this.fetchBlock(lastBuffered);
    } catch (err) {
      this.logger.warn(
        `[chain:${this.chainName}] ReorgDetector: RPC error re-validating block ${lastBuffered}: ${String(err)}; skipping tick`,
      );
      return;
    }

    const bufferedHash = this.buffer.get(lastBuffered);
    if (canonicalLast !== null && canonicalLast.hash === bufferedHash) {
      // Gap is benign — clean advance
      this.bufferSet(head.blockNumber, head.blockHash);
      this.lastHead = head;
    } else {
      // Reorg-during-gap: divergence is in or before the gap
      await this.runReorgPath(head, lastBuffered, head.blockNumber - 1n);
    }
  }

  private getOldestBufferedBlock(): bigint | null {
    if (this.buffer.size === 0) return null;
    let oldest: bigint | null = null;
    for (const k of this.buffer.keys()) {
      if (oldest === null || k < oldest) oldest = k;
    }
    return oldest;
  }

  private getNewestBufferedBlock(): bigint | null {
    if (this.buffer.size === 0) return null;
    let newest: bigint | null = null;
    for (const k of this.buffer.keys()) {
      if (newest === null || k > newest) newest = k;
    }
    return newest;
  }

  private bufferSet(blockNumber: bigint, blockHash: string): void {
    this.buffer.set(blockNumber, blockHash);
    // Evict in a loop — a single rewritten reorg path can push the buffer well past
    // the bound, so one eviction per insert is not enough.
    while (this.buffer.size > this.reorgHorizon + 1) {
      const oldest = this.getOldestBufferedBlock();
      if (oldest === null) break;
      this.buffer.delete(oldest);
    }
  }

  private async backfillBuffer(coldStartHead: Head): Promise<void> {
    let expectedParentHash = coldStartHead.parentHash;
    for (let i = 1; i <= this.reorgHorizon; i++) {
      const blockNumber = coldStartHead.blockNumber - BigInt(i);
      if (blockNumber < 0n) return;
      let block: BlockHeader | null;
      try {
        block = await this.fetchBlock(blockNumber);
      } catch (err) {
        this.logger.warn(
          `[chain:${this.chainName}] ReorgDetector: cold-start back-fill RPC error at block ${blockNumber}: ${String(err)}; stopping at depth ${i - 1}`,
        );
        return;
      }
      if (block === null) {
        this.logger.warn(
          `[chain:${this.chainName}] ReorgDetector: cold-start back-fill missing block ${blockNumber}; stopping at depth ${i - 1}`,
        );
        return;
      }
      if (block.hash !== expectedParentHash) {
        // Mid-fill reorg or RPC-level inconsistency. Bail out rather than persist a
        // buffer entry that disagrees with the head we just trusted.
        this.logger.warn(
          `[chain:${this.chainName}] ReorgDetector: cold-start back-fill parent-hash mismatch at ${blockNumber} ` +
            `(got ${block.hash}, expected ${expectedParentHash}); stopping at depth ${i - 1}`,
        );
        return;
      }
      this.bufferSet(blockNumber, block.hash);
      expectedParentHash = block.parentHash;
    }
  }

  private async fetchBlock(blockNumber: bigint): Promise<BlockHeader | null> {
    const hexBlock = '0x' + blockNumber.toString(16);
    const raw = await this.rpcClient.send<Record<string, unknown> | null>('eth_getBlockByNumber', [
      hexBlock,
      false,
    ]);
    if (raw === null) return null;
    const hash = String(raw['hash'] ?? '').toLowerCase();
    const parentHash = String(raw['parentHash'] ?? '').toLowerCase();
    if (!hash || !parentHash)
      throw new Error('Malformed block response: missing hash or parentHash');
    return { hash, parentHash };
  }

  private async runReorgPath(
    h: Head,
    lo: bigint,
    hi: bigint,
    chainShrunkInitial = false,
  ): Promise<void> {
    // Wholesale re-fetch canonical blocks for [lo, hi]
    const canonical = new Map<bigint, BlockHeader | null>();
    for (let b = lo; b <= hi; b++) {
      let block: BlockHeader | null;
      try {
        block = await this.fetchBlock(b);
      } catch (err) {
        this.logger.warn(
          `[chain:${this.chainName}] ReorgDetector: transient RPC error re-fetching block ${b}: ${String(err)}; dropping signal`,
        );
        // Do NOT advance lastHead — next tick retries from same buffer state
        return;
      }
      canonical.set(b, block);
    }

    const oldestBuffered = this.getOldestBufferedBlock();

    // Refine divergence point by walking forward from lo.
    // Two indicators: parent-hash mismatch (chain linkage broke) or hash mismatch
    // at the same block (same-height fork, e.g. Case 3b / Case 2).
    let divergenceBlockNumber = lo;
    for (let b = lo; b <= hi; b++) {
      const canon = canonical.get(b);
      if (canon === undefined) {
        // Map was fully populated for [lo, hi]; this branch is unreachable
        continue;
      }
      if (canon === null) {
        // Chain shrunk — definite divergence
        divergenceBlockNumber = b;
        break;
      }
      // Hash mismatch at b: both chains have a block here but with different content
      const bufferedAtB = this.buffer.get(b);
      if (bufferedAtB !== undefined && canon.hash !== bufferedAtB) {
        divergenceBlockNumber = b;
        break;
      }
      // Parent-hash mismatch: chain linkage broke at b (divergence is at or below b)
      const prevBuffered = this.buffer.get(b - 1n);
      if (prevBuffered !== undefined && canon.parentHash !== prevBuffered) {
        divergenceBlockNumber = b;
        break;
      }
    }

    // Clamp if divergence reaches or exceeds the oldest buffered block
    let truncated = false;
    if (oldestBuffered !== null && divergenceBlockNumber <= oldestBuffered) {
      truncated = true;
      divergenceBlockNumber = oldestBuffered;
    }

    // Build orphaned and canonical arrays for [divergenceBlockNumber, hi].
    // Missing buffer entries (truncated reorgs) surface as `null` so consumers can
    // distinguish "no buffered hash for this slot" from a real zero-hash block.
    const orphanedBlockHashes: (string | null)[] = [];
    const canonicalBlockHashes: (string | null)[] = [];
    for (let b = divergenceBlockNumber; b <= hi; b++) {
      orphanedBlockHashes.push(this.buffer.get(b) ?? null);
      const canon = canonical.get(b);
      canonicalBlockHashes.push(canon ? canon.hash : null);
    }

    const chainShrunk = chainShrunkInitial || canonicalBlockHashes.some((x) => x === null);

    const signal: ReorgSignal = {
      chainId: this.chainId,
      detectedAt: new Date(),
      observedAt: h.observedAt,
      divergenceBlockNumber,
      orphanedBlockHashes,
      canonicalBlockHashes,
      truncated,
      chainShrunk,
    };

    chainMetrics.reorgSignals.add(1, { chain: this.chainName });
    await this.emitReorg(signal);

    // Update buffer with canonical data for [divergenceBlockNumber, hi]. Route inserts
    // through bufferSet so the horizon+1 bound is enforced even when the rewritten
    // range extends past the previous newest buffered block (Case 4a gap reorg).
    for (let b = divergenceBlockNumber; b <= hi; b++) {
      const canon = canonical.get(b);
      if (canon !== null && canon !== undefined) {
        this.bufferSet(b, canon.hash);
      } else {
        this.buffer.delete(b);
      }
    }

    // Record triggering head if it falls outside the rewritten range
    if (h.blockNumber > hi || h.blockNumber < divergenceBlockNumber) {
      this.bufferSet(h.blockNumber, h.blockHash);
    }

    this.lastHead = h;
  }

  private async emitReorg(signal: ReorgSignal): Promise<void> {
    for (const listener of this.reorgListeners) {
      try {
        await listener(signal);
      } catch (err) {
        this.logger.error(
          `[chain:${this.chainName}] ReorgDetector: reorg listener threw: ${String(err)}`,
        );
      }
    }
  }

  private async emitBufferReset(signal: BufferResetSignal): Promise<void> {
    for (const listener of this.resetListeners) {
      try {
        await listener(signal);
      } catch (err) {
        this.logger.error(
          `[chain:${this.chainName}] ReorgDetector: buffer-reset listener threw: ${String(err)}`,
        );
      }
    }
  }
}
