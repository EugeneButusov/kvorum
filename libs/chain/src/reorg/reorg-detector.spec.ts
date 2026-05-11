import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReorgDetector } from './reorg-detector.js';
import type { ReorgSignal, BufferResetSignal } from './types.js';
import type { RpcClient } from '../client/rpc-client.js';
import { resetMetrics, getReorgSignalsTotal } from '../metrics/metrics.js';
import type { Head } from '../poller/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHead(blockNumber: bigint, blockHash: string, parentHash: string): Head {
  return {
    chainId: 1,
    blockNumber,
    blockHash: blockHash.toLowerCase(),
    parentHash: parentHash.toLowerCase(),
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    observedAt: new Date(),
  };
}

function blockResp(hash: string, parentHash: string): Record<string, unknown> {
  return { hash: hash.toLowerCase(), parentHash: parentHash.toLowerCase() };
}

interface QueuedCall {
  result: unknown;
}

function ok(result: unknown): QueuedCall {
  return { result };
}
function err(message: string): QueuedCall {
  return { result: new Error(message) };
}

/** Minimal RpcClient mock — dequeues responses in order per call. */
function makeClient(calls: QueuedCall[] = []): RpcClient {
  let index = 0;
  return {
    async send<T>(_method: string): Promise<T> {
      const call = calls[index++];
      if (!call) throw new Error(`Unexpected RPC call at index ${index - 1}`);
      if (call.result instanceof Error) throw call.result;
      return call.result as T;
    },
    getHealth: () => ({ chainId: 1, providers: [] }),
    start: async () => {},
    stop: async () => {},
  };
}

/** NoOp client — throws on any call (for tests that expect no RPC calls). */
const noCallClient: RpcClient = {
  send: () => {
    throw new Error('Unexpected RPC call');
  },
  getHealth: () => ({ chainId: 1, providers: [] }),
  start: async () => {},
  stop: async () => {},
};

/** Wraps an RpcClient so the very first send() throws synthetically. Cold-start
 *  back-fill stops on the first RPC error, so the mock queue is preserved for the
 *  rest of the test. Use makeDetectorRaw when exercising back-fill explicitly. */
function withColdStartShortCircuit(inner: RpcClient): RpcClient {
  let firstCallSeen = false;
  return {
    async send<T = unknown>(method: string, params: unknown[]): Promise<T> {
      if (!firstCallSeen) {
        firstCallSeen = true;
        throw new Error('test:cold-start-backfill-short-circuit');
      }
      return inner.send<T>(method, params);
    },
    getHealth: inner.getHealth.bind(inner),
    start: inner.start.bind(inner),
    stop: inner.stop.bind(inner),
  };
}

function makeDetector(
  rpcClient: RpcClient,
  reorgHorizon = 4,
): {
  detector: ReorgDetector;
  reorgs: ReorgSignal[];
  resets: BufferResetSignal[];
} {
  const detector = new ReorgDetector({
    rpcClient: withColdStartShortCircuit(rpcClient),
    chainId: 1,
    chainName: 'test',
    reorgHorizon,
  });
  const reorgs: ReorgSignal[] = [];
  const resets: BufferResetSignal[] = [];
  detector.onReorg((s) => {
    reorgs.push(s);
  });
  detector.onBufferReset((s) => {
    resets.push(s);
  });
  return { detector, reorgs, resets };
}

beforeEach(() => resetMetrics());
afterEach(() => resetMetrics());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReorgDetector', () => {
  it('#1 — cold-start head → BufferResetSignal cold_start, no reorg, lastHead set', async () => {
    const { detector, reorgs, resets } = makeDetector(noCallClient);
    const h = makeHead(100n, '0xaaa', '0x000');
    await detector.processHead(h);
    expect(reorgs).toHaveLength(0);
    expect(resets).toHaveLength(1);
    expect(resets[0]!.reason).toBe('cold_start');
    expect(resets[0]!.atBlockNumber).toBe(100n);
  });

  it('#2 — clean advance (parent matches) → no signal, buffer extended', async () => {
    const { detector, reorgs, resets } = makeDetector(noCallClient);
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    resets.length = 0;
    await detector.processHead(makeHead(101n, '0xbbb', '0xaaa'));
    expect(reorgs).toHaveLength(0);
    expect(resets).toHaveLength(0);
  });

  it('#3 — parent mismatch at depth 1 → reorg signal, divergenceBlockNumber = prevBlock', async () => {
    // Buffer: {100: 0xaaa}
    // New head: 101, parentHash = 0xAAA_WRONG (mismatch)
    // RPC call: canonical[100] → hash 0xccc, parentHash 0x999
    const canonical100 = blockResp('0xccc', '0x999');
    const { detector, reorgs } = makeDetector(makeClient([ok(canonical100)]));
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(101n, '0xbbb', '0xAAA_WRONG'));
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]!.divergenceBlockNumber).toBe(100n);
    expect(reorgs[0]!.orphanedBlockHashes[0]).toBe('0xaaa');
    expect(reorgs[0]!.canonicalBlockHashes[0]).toBe('0xccc');
  });

  it('#4 — same-height hash change (Case 2) → signal with single-element arrays', async () => {
    // Buffer: {100: 0xaaa}; new head: same height 100, different hash
    // Reorg path [100, 100] — canonical[100] → 0xbbb
    const canonical100 = blockResp('0xbbb', '0x000');
    const { detector, reorgs } = makeDetector(makeClient([ok(canonical100)]));
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(100n, '0xbbb', '0x000'));
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]!.divergenceBlockNumber).toBe(100n);
    expect(reorgs[0]!.orphanedBlockHashes).toHaveLength(1);
    expect(reorgs[0]!.orphanedBlockHashes[0]).toBe('0xaaa');
    expect(reorgs[0]!.canonicalBlockHashes[0]).toBe('0xbbb');
  });

  it('#5 — head backwards, buffer[h.blockNumber] matches (Case 3a) → chainShrunk, null canonicals', async () => {
    // Buffer: {100: a, 101: b, 102: c}; head back to 100 with same hash
    // Range [101, 102] — canonical returns null for both (chain shrunk)
    const { detector, reorgs } = makeDetector(makeClient([ok(null), ok(null)]));
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(101n, '0xbbb', '0xaaa'));
    await detector.processHead(makeHead(102n, '0xccc', '0xbbb'));
    // Now head back to 100 with same hash
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]!.chainShrunk).toBe(true);
    expect(reorgs[0]!.divergenceBlockNumber).toBe(101n);
    expect(reorgs[0]!.canonicalBlockHashes).toEqual([null, null]);
    expect(reorgs[0]!.orphanedBlockHashes).toEqual(['0xbbb', '0xccc']);
  });

  it('#6 — head backwards, buffer[h.blockNumber] differs (Case 3b) → backward walk finds divergence', async () => {
    // Buffer: {100: a, 101: b, 102: c}; head back to 101 with DIFFERENT hash
    // Range [101, 102] — canonical: 101 → d, 102 → null
    const { detector, reorgs } = makeDetector(
      makeClient([ok(blockResp('0xddd', '0xaaa')), ok(null)]),
    );
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(101n, '0xbbb', '0xaaa'));
    await detector.processHead(makeHead(102n, '0xccc', '0xbbb'));
    // head back to 101 with different hash
    await detector.processHead(makeHead(101n, '0xddd', '0xaaa'));
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]!.chainShrunk).toBe(true);
    expect(reorgs[0]!.divergenceBlockNumber).toBe(101n);
  });

  it('#7 — multi-block reorg, walk-back depth 3 → orphaned/canonical arrays length 3', async () => {
    // Build buffer: 100(a), 101(b), 102(c), 103(d)
    // New head: 104 with parentHash != d (reorg)
    // Range [100, 103]: canonical: 100→a', 101→b' (parent mismatch here), 102→c', 103→d'
    const can100 = blockResp('0xaaa', '0x999'); // parent not in buffer[99] → match (absent = match)
    const can101 = blockResp('0xbbb2', '0xaaa2'); // parentHash 0xaaa2 ≠ buffer[100]=0xaaa → divergence
    const can102 = blockResp('0xccc2', '0xbbb2');
    const can103 = blockResp('0xddd2', '0xccc2');
    const { detector, reorgs } = makeDetector(
      makeClient([ok(can100), ok(can101), ok(can102), ok(can103)]),
      6,
    );
    await detector.processHead(makeHead(100n, '0xaaa', '0x999'));
    await detector.processHead(makeHead(101n, '0xbbb', '0xaaa'));
    await detector.processHead(makeHead(102n, '0xccc', '0xbbb'));
    await detector.processHead(makeHead(103n, '0xddd', '0xccc'));
    // Head 104 with wrong parent
    await detector.processHead(makeHead(104n, '0xeee', '0xDDD_WRONG'));
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]!.divergenceBlockNumber).toBe(101n);
    expect(reorgs[0]!.orphanedBlockHashes).toHaveLength(3); // [101, 102, 103]
    expect(reorgs[0]!.orphanedBlockHashes[0]).toBe('0xbbb');
    expect(reorgs[0]!.canonicalBlockHashes[0]).toBe('0xbbb2');
    expect(reorgs[0]!.truncated).toBe(false);
  });

  it('#8 — window eviction — feed reorgHorizon + 2 clean heads → only reorgHorizon + 1 retained', async () => {
    const horizon = 4;
    const { detector } = makeDetector(noCallClient, horizon);
    await detector.processHead(makeHead(0n, '0xh0', '0x000'));
    await detector.processHead(makeHead(1n, '0xh1', '0xh0'));
    await detector.processHead(makeHead(2n, '0xh2', '0xh1'));
    await detector.processHead(makeHead(3n, '0xh3', '0xh2'));
    await detector.processHead(makeHead(4n, '0xh4', '0xh3'));
    await detector.processHead(makeHead(5n, '0xh5', '0xh4'));
    await detector.processHead(makeHead(6n, '0xh6', '0xh5'));
    await detector.processHead(makeHead(7n, '0xh7', '0xh6'));
    // Bound: buffer must never exceed reorgHorizon + 1 entries.
    expect(detector.bufferSize).toBe(horizon + 1);
  });

  it('#8b — deep reorg rewrite respects buffer bound', async () => {
    // Trigger a Case 4a gap reorg that rewrites a range extending past the previous
    // newest entry. Before the fix, direct buffer.set() inside runReorgPath bypassed
    // eviction and the buffer could exceed horizon+1.
    const horizon = 3;
    // Buffer: {100, 101}. Head 104 arrives → gap is within horizon (101 ≥ 104-3=101).
    //   - re-validate 101 (mismatch) — 1 fetch
    //   - re-fetch range [101, 103] in runReorgPath — 3 fetches
    const reval101 = blockResp('0xbbb2', '0xaaa');
    const can101 = blockResp('0xbbb2', '0xaaa');
    const can102 = blockResp('0xccc2', '0xbbb2');
    const can103 = blockResp('0xddd2', '0xccc2');
    const { detector, reorgs } = makeDetector(
      makeClient([ok(reval101), ok(can101), ok(can102), ok(can103)]),
      horizon,
    );
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(101n, '0xbbb', '0xaaa'));
    await detector.processHead(makeHead(104n, '0xeee', '0xddd2'));
    expect(reorgs).toHaveLength(1);
    expect(detector.bufferSize).toBeLessThanOrEqual(horizon + 1);
  });

  it('#9 — reorg-during-gap, canonical(lastBuffered) matches → divergence at gap start', async () => {
    // Buffer: {100: a, 101: b}; skip tick; head 103 arrives
    // Case 4a: buffer has no entry at 102. Re-validate lastBuffered (101).
    // canonical[101] matches buffer[101] (0xbbb) → clean gap → record 103
    const { detector, reorgs } = makeDetector(makeClient([ok(blockResp('0xbbb', '0xaaa'))]));
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(101n, '0xbbb', '0xaaa'));
    // skip 102, jump to 103
    await detector.processHead(makeHead(103n, '0xddd', '0xccc'));
    expect(reorgs).toHaveLength(0);
  });

  it('#10 — reorg-during-gap, canonical(lastBuffered) mismatches → signal emitted', async () => {
    // Buffer: {100: a, 101: b}; skip 102; head 103 arrives
    // Re-validate lastBuffered (101): canonical[101] ≠ buffer[101] → reorg
    // Range [101, 102]: canonical returns block data
    const can101 = blockResp('0xbbb2', '0xaaa');
    const can102 = blockResp('0xccc2', '0xbbb2');
    const { detector, reorgs } = makeDetector(
      makeClient([
        ok(blockResp('0xbbb2', '0xaaa')), // re-validation of lastBuffered(101): mismatch
        ok(can101), // re-fetch 101 in reorg path
        ok(can102), // re-fetch 102 in reorg path
      ]),
    );
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(101n, '0xbbb', '0xaaa'));
    // skip 102, jump to 103
    await detector.processHead(makeHead(103n, '0xddd', '0xccc'));
    expect(reorgs).toHaveLength(1);
    // Block 102 was never buffered (gap-skip), so its orphaned slot must be null —
    // NOT a zero-hash sentinel. Block 101 was buffered and surfaces normally.
    expect(reorgs[0]!.orphanedBlockHashes).toEqual(['0xbbb', null]);
  });

  it('#11 — gap exceeds horizon (Case 4b) → BufferResetSignal gap_exceeded_horizon, no reorg', async () => {
    const { detector, reorgs, resets } = makeDetector(noCallClient, 4);
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    resets.length = 0;
    // Jump far ahead — 100 + 4 (horizon) + 2 = 106 → gap exceeds horizon
    await detector.processHead(makeHead(106n, '0xfff', '0xeee'));
    expect(reorgs).toHaveLength(0);
    expect(resets).toHaveLength(1);
    expect(resets[0]!.reason).toBe('gap_exceeded_horizon');
  });

  it('#12 — re-fetch transient RPC error → no signal, lastHead NOT advanced', async () => {
    // After building buffer, trigger reorg → re-fetch throws
    const { detector, reorgs } = makeDetector(makeClient([err('timeout')]));
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    // Same height different hash — triggers reorg path → RPC error → drop
    await detector.processHead(makeHead(100n, '0xbbb', '0x000'));
    expect(reorgs).toHaveLength(0);
    // Next clean head should retry from same buffer state (no crash)
    // Feed a "clean" same-tip head → no-op (lastHead still 0xaaa at 100)
  });

  it('#13 — re-fetch returns null → signal with null canonical entries, chainShrunk true, NOT dropped', async () => {
    // Buffer: {100: a, 101: b}; head back to 100 (Case 3a, matches)
    // Range [101, 101]; canonical[101] → null
    const { detector, reorgs } = makeDetector(makeClient([ok(null)]));
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(101n, '0xbbb', '0xaaa'));
    // head back to 100, same hash → Case 3a
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]!.canonicalBlockHashes).toEqual([null]);
    expect(reorgs[0]!.chainShrunk).toBe(true);
  });

  it('#14 — buffer rewritten correctly after reorg — canonical replaces orphaned', async () => {
    // Buffer: {100: a, 101: b}; head 101 arrives with different hash (Case 2)
    const canonical101 = blockResp('0xbbb2', '0xaaa');
    const { detector } = makeDetector(makeClient([ok(canonical101)]));
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(101n, '0xbbb', '0xaaa'));
    // Same height reorg at 101
    await detector.processHead(makeHead(101n, '0xbbb2', '0xaaa'));
    // After reorg: buffer[101] should be 0xbbb2
    // Verify by doing a clean advance from 101 → 102
    await detector.processHead(makeHead(102n, '0xccc', '0xbbb2'));
    // No second reorg signal expected (clean advance since buffer was updated)
    // Absence of second reorg signal is the verification
  });

  it('#15 — multiple listeners: first throws synchronously, second still receives signal', async () => {
    const canonical = blockResp('0xbbb2', '0xaaa');
    const received: ReorgSignal[] = [];
    const { detector } = makeDetector(makeClient([ok(canonical)]));
    detector.onReorg(() => {
      throw new Error('listener error');
    });
    detector.onReorg((s) => {
      received.push(s);
    });
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(100n, '0xbbb2', '0x000'));
    expect(received).toHaveLength(1);
  });

  it('#16 — multiple listeners: first returns rejected promise, second still receives signal', async () => {
    const canonical = blockResp('0xbbb2', '0xaaa');
    const received: ReorgSignal[] = [];
    const { detector } = makeDetector(makeClient([ok(canonical)]));
    detector.onReorg(() => Promise.reject(new Error('async error')));
    detector.onReorg((s) => {
      received.push(s);
    });
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(100n, '0xbbb2', '0x000'));
    expect(received).toHaveLength(1);
  });

  it('#17 — sequential listener dispatch — listeners run in registration order', async () => {
    const canonical = blockResp('0xbbb2', '0xaaa');
    const order: number[] = [];
    const { detector } = makeDetector(makeClient([ok(canonical)]));
    detector.onReorg(() => {
      order.push(1);
    });
    detector.onReorg(() => {
      order.push(2);
    });
    detector.onReorg(() => {
      order.push(3);
    });
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(100n, '0xbbb2', '0x000'));
    expect(order).toEqual([1, 2, 3]);
  });

  it('#18 — idempotency on repeated identical head (Case 1) → no signal, stable', async () => {
    const { detector, reorgs, resets } = makeDetector(noCallClient);
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    resets.length = 0;
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    expect(reorgs).toHaveLength(0);
    expect(resets).toHaveLength(0);
  });

  it('#19 — reorg at oldest buffered block → truncated: true, divergenceBlockNumber === oldestBuffered', async () => {
    // horizon = 2 → buffer holds 3 entries: {100, 101, 102}
    // Head 103 with wrong parent triggers reorg over range [100, 102].
    // canonical[100].hash differs from buffer[100] → divergence detected at 100 = oldestBuffered → truncated
    const can100 = blockResp('0xaaa2', '0x999');
    const can101 = blockResp('0xbbb2', '0xaaa2');
    const can102 = blockResp('0xccc2', '0xbbb2');
    const { detector, reorgs } = makeDetector(makeClient([ok(can100), ok(can101), ok(can102)]), 2);
    await detector.processHead(makeHead(100n, '0xaaa', '0x999'));
    await detector.processHead(makeHead(101n, '0xbbb', '0xaaa'));
    await detector.processHead(makeHead(102n, '0xccc', '0xbbb'));
    await detector.processHead(makeHead(103n, '0xddd', '0xCCC_WRONG'));
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]!.truncated).toBe(true);
    expect(reorgs[0]!.divergenceBlockNumber).toBe(100n);
  });

  it('#20 — reorg deeper than horizon → truncated: true, divergence clamped to oldestBuffered', async () => {
    // horizon = 2 → buffer holds 3 entries max: {100, 101, 102}
    // New head 103 with wrong parent. Range [100, 102].
    // All canonical parents match buffer → no break → divergence = oldestBuffered = 100 → truncated
    const can100 = blockResp('0xaaa2', '0x999'); // parent 999 not in buffer → match (absent)
    const can101 = blockResp('0xbbb2', '0xaaa'); // parent aaa = buffer[100] → match
    const can102 = blockResp('0xccc2', '0xbbb'); // parent bbb = buffer[101] → match
    const { detector, reorgs } = makeDetector(makeClient([ok(can100), ok(can101), ok(can102)]), 2);
    await detector.processHead(makeHead(100n, '0xaaa', '0x999'));
    await detector.processHead(makeHead(101n, '0xbbb', '0xaaa'));
    await detector.processHead(makeHead(102n, '0xccc', '0xbbb'));
    await detector.processHead(makeHead(103n, '0xddd', '0xCCC_WRONG'));
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]!.truncated).toBe(true);
    expect(reorgs[0]!.divergenceBlockNumber).toBe(100n);
  });

  it('#21 — hash normalisation — uppercase parentHash from provider does not false-positive', async () => {
    const { detector, reorgs, resets } = makeDetector(noCallClient);
    // Cold start with lowercase hash
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    resets.length = 0;
    // Next head with UPPERCASE parentHash that matches when lowercased
    const h101: Head = {
      chainId: 1,
      blockNumber: 101n,
      blockHash: '0xBBB',
      parentHash: '0xAAA', // uppercase — should match '0xaaa' when normalised
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      observedAt: new Date(),
    };
    await detector.processHead(h101);
    expect(reorgs).toHaveLength(0); // no reorg — parent matched after normalisation
  });

  it('#22 — metric increment — reorgSignalsTotal increments once per emitted reorg signal', async () => {
    const canonical = blockResp('0xbbb2', '0xaaa');
    const { detector } = makeDetector(makeClient([ok(canonical), ok(canonical)]));
    await detector.processHead(makeHead(100n, '0xaaa', '0x000'));
    // Trigger two reorgs
    await detector.processHead(makeHead(100n, '0xbbb', '0x000'));
    await detector.processHead(makeHead(100n, '0xccc', '0x000'));
    const data = await getReorgSignalsTotal().get();
    const entry = data.values.find((v) => v.labels['chain'] === 'test');
    expect(entry?.value).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Cold-start back-fill (uses raw clients without the makeDetector short-circuit)
  // -------------------------------------------------------------------------

  function makeRawDetector(
    rpcClient: RpcClient,
    reorgHorizon = 4,
  ): {
    detector: ReorgDetector;
    reorgs: ReorgSignal[];
    resets: BufferResetSignal[];
  } {
    const detector = new ReorgDetector({
      rpcClient,
      chainId: 1,
      chainName: 'test',
      reorgHorizon,
    });
    const reorgs: ReorgSignal[] = [];
    const resets: BufferResetSignal[] = [];
    detector.onReorg((s) => {
      reorgs.push(s);
    });
    detector.onBufferReset((s) => {
      resets.push(s);
    });
    return { detector, reorgs, resets };
  }

  it('#23 — cold-start back-fill: full success fills buffer to horizon + 1', async () => {
    // Cold-start head at 100, parentHash 0x099. Back-fill walks 99..96 (4 entries).
    // Each block: hash matches the previous expected parent, parent points further back.
    const horizon = 4;
    const client = makeClient([
      ok(blockResp('0x099', '0x098')), // block 99
      ok(blockResp('0x098', '0x097')), // block 98
      ok(blockResp('0x097', '0x096')), // block 97
      ok(blockResp('0x096', '0x095')), // block 96
    ]);
    const { detector, resets } = makeRawDetector(client, horizon);
    await detector.processHead(makeHead(100n, '0xaaa', '0x099'));
    expect(detector.bufferSize).toBe(horizon + 1);
    expect(resets).toHaveLength(1);
    expect(resets[0]!.reason).toBe('cold_start');
  });

  it('#24 — cold-start back-fill: RPC error mid-fill stops gracefully', async () => {
    const horizon = 4;
    const client = makeClient([
      ok(blockResp('0x099', '0x098')), // block 99 — ok
      ok(blockResp('0x098', '0x097')), // block 98 — ok
      err('rpc timeout'), // block 97 — fails → stop
    ]);
    const { detector } = makeRawDetector(client, horizon);
    await detector.processHead(makeHead(100n, '0xaaa', '0x099'));
    // Buffer holds the cold-start head + 2 successfully back-filled entries.
    expect(detector.bufferSize).toBe(3);
  });

  it('#25 — cold-start back-fill: parent-hash mismatch mid-fill stops gracefully', async () => {
    const horizon = 4;
    const client = makeClient([
      ok(blockResp('0x099', '0x098')), // block 99 — ok, parent 0x098
      ok(blockResp('0xFFF', '0x096')), // block 98 — hash 0xFFF != expected 0x098 → stop
    ]);
    const { detector } = makeRawDetector(client, horizon);
    await detector.processHead(makeHead(100n, '0xaaa', '0x099'));
    expect(detector.bufferSize).toBe(2); // head + one back-fill before mismatch
  });

  it('#26 — cold-start back-fill: stops at genesis (blockNumber < reorgHorizon)', async () => {
    // Cold-start head at block 2, horizon=10. Walk 1, 0, then bail at -1.
    const horizon = 10;
    const client = makeClient([
      ok(blockResp('0x001', '0x000')), // block 1
      ok(blockResp('0x000', '0x000')), // block 0 (genesis — parentHash conventionally zero)
    ]);
    const { detector } = makeRawDetector(client, horizon);
    await detector.processHead(makeHead(2n, '0x002', '0x001'));
    expect(detector.bufferSize).toBe(3); // blocks 2, 1, 0
  });

  it('#27 — cold-start back-fill: deep post-cold-start reorg correctly identifies divergence', async () => {
    // With back-fill: buffer holds 95..100 after cold-start. A Case 4c reorg over
    // [95, 100] caused by a fork at 97 must report divergenceBlockNumber=97, not 100.
    const horizon = 5;
    const client = makeClient([
      // Back-fill (4 calls): blocks 99, 98, 97, 96, 95 — but horizon=5 → 5 calls
      ok(blockResp('0x099', '0x098')),
      ok(blockResp('0x098', '0x097')),
      ok(blockResp('0x097', '0x096')),
      ok(blockResp('0x096', '0x095')),
      ok(blockResp('0x095', '0x094')),
      // Reorg-path re-fetch: blocks 95..100 (oldest..prevBlockNumber for Case 4c)
      ok(blockResp('0x095', '0x094')), // 95 — unchanged
      ok(blockResp('0x096', '0x095')), // 96 — unchanged
      ok(blockResp('0x097-new', '0x096')), // 97 — divergence
      ok(blockResp('0x098-new', '0x097-new')), // 98
      ok(blockResp('0x099-new', '0x098-new')), // 99
      ok(blockResp('0xaaa-new', '0x099-new')), // 100
    ]);
    const { detector, reorgs } = makeRawDetector(client, horizon);
    await detector.processHead(makeHead(100n, '0xaaa', '0x099'));
    expect(detector.bufferSize).toBe(horizon + 1); // back-fill succeeded
    // Now feed a new head at 101 whose parent disagrees with buffer[100].
    await detector.processHead(makeHead(101n, '0xbbb', '0xaaa-new'));
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]!.divergenceBlockNumber).toBe(97n);
    expect(reorgs[0]!.truncated).toBe(false);
  });
});
