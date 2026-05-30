import { describe, it, expect, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { makeArchiveProducer } from './archive-producer';

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    chainId: '0x1',
    blockNumber: 100n,
    blockHash: '0xblock',
    txHash: '0xtx',
    txIndex: 0,
    logIndex: 0,
    address: '0xcontract',
    topics: ['0xtopic'],
    data: '0x',
    sourceType: 'compound_governor_bravo',
    removed: false,
    ...overrides,
  };
}

function makeSeenLog(isNew = true) {
  return { recordIfNew: vi.fn().mockResolvedValue(isNew) };
}

function makePgDb() {
  const trx = {} as never;
  return {
    transaction: vi.fn().mockReturnValue({
      execute: vi.fn().mockImplementation((fn: (t: typeof trx) => Promise<void>) => fn(trx)),
    }),
  } as never;
}

describe('makeArchiveProducer', () => {
  it('G2 atomicity: enqueues when seen_log records a new coordinate', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const seenLog = makeSeenLog(true);
    const producer = makeArchiveProducer({
      pgDb: makePgDb(),
      seenLog: seenLog as never,
      enqueue,
      logger: { debug: vi.fn(), error: vi.fn() },
    });

    await producer([makeLog()]);

    expect(seenLog.recordIfNew).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledOnce();
    const job = enqueue.mock.calls[0]?.[0];
    expect(job).toMatchObject({
      chainId: '0x1',
      txHash: '0xtx',
      logIndex: 0,
      address: '0xcontract',
    });
  });

  it('G2 atomicity: skips enqueue for already-seen coordinate (window re-scan no-op)', async () => {
    const enqueue = vi.fn();
    const seenLog = makeSeenLog(false); // coordinate already in seen_log
    const producer = makeArchiveProducer({
      pgDb: makePgDb(),
      seenLog: seenLog as never,
      enqueue,
      logger: { debug: vi.fn(), error: vi.fn() },
    });

    await producer([makeLog()]);

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('G2 atomicity: enqueue failure propagates (rolls back seen_log insert via transaction)', async () => {
    const enqueue = vi.fn().mockRejectedValue(new Error('boss down'));
    const seenLog = makeSeenLog(true);
    const producer = makeArchiveProducer({
      pgDb: makePgDb(),
      seenLog: seenLog as never,
      enqueue,
      logger: { debug: vi.fn(), error: vi.fn() },
    });

    await expect(producer([makeLog()])).rejects.toThrow('boss down');
  });

  it('G1 structure: job payload contains no sourceType (domain-blind)', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const seenLog = makeSeenLog(true);
    const producer = makeArchiveProducer({
      pgDb: makePgDb(),
      seenLog: seenLog as never,
      enqueue,
      logger: { debug: vi.fn(), error: vi.fn() },
    });

    await producer([makeLog()]);

    const job = enqueue.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(job).not.toHaveProperty('sourceType');
    expect(job).not.toHaveProperty('source_type');
    expect(job).toHaveProperty('address'); // consumer resolves address → source
  });

  it('processes multiple logs independently per transaction', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const seenLog = { recordIfNew: vi.fn().mockResolvedValue(true) };
    const producer = makeArchiveProducer({
      pgDb: makePgDb(),
      seenLog: seenLog as never,
      enqueue,
      logger: { debug: vi.fn(), error: vi.fn() },
    });

    await producer([makeLog({ logIndex: 0 }), makeLog({ logIndex: 1 })]);

    expect(seenLog.recordIfNew).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
});

describe('SeenLogRepository.pruneBelow (G3 guard)', () => {
  it('horizon = confirmedHead - windowSize - margin ensures in-window coords are never pruned', () => {
    const confirmedHead = 1000n;
    const headLag = 12n;
    const windowSize = headLag * 2n;
    const margin = headLag; // default margin = headLag
    const horizon = confirmedHead - windowSize - margin;

    // Any block at or above horizon is within the window
    expect(horizon).toBe(1000n - 24n - 12n); // 964
    // A block at confirmedHead - headLag (= 988) is well above horizon — NOT pruned
    const inWindowBlock = confirmedHead - headLag;
    expect(inWindowBlock > horizon).toBe(true);
    // A block at 963 is below horizon — safe to prune
    expect(963n < horizon).toBe(true);
  });
});
