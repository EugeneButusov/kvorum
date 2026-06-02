import { describe, it, expect, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { LogEvent } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveWriteContext } from './archive-writer-types';
import type { BaseArchiveWriter } from './base-archive-writer';
import { DecodeError } from './decode-error';
import { makeIngesterListener } from './ingester-listener';

type TestEvent = { type: 'VoteCast'; payload: Record<string, unknown> };

const CTX: ArchiveWriteContext = {
  daoSourceId: 'dao-src-1',
  sourceType: 'compound_governor_bravo',
  chainId: '0x1',
  sourceLabel: 'compound_governor_bravo',
};

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'compound_governor_bravo',
    chainId: 1,
    blockNumber: 20_000_000n,
    blockHash: '0x' + 'ab'.repeat(32),
    txHash: '0x' + 'cd'.repeat(32),
    txIndex: 0,
    logIndex: 0,
    address: '0x' + 'ef'.repeat(20),
    topics: ['0x' + '00'.repeat(32)],
    data: '0x',
    ...overrides,
  };
}

function makeWriter(
  writeImpl?: () => Promise<{
    result: 'inserted' | 'skipped_existing' | 'dlq_routed' | 'unreachable' | 'skipped_conflict';
  }>,
): BaseArchiveWriter<TestEvent> {
  return {
    write: vi.fn().mockImplementation(writeImpl ?? (() => Promise.resolve({ result: 'inserted' }))),
  } as unknown as BaseArchiveWriter<TestEvent>;
}

function makeDlqRepo(): DlqRepository {
  return { insert: vi.fn().mockResolvedValue(undefined) } as unknown as DlqRepository;
}

const DECODED: TestEvent = { type: 'VoteCast', payload: {} };
const decode = vi.fn<[LogEvent], TestEvent>().mockReturnValue(DECODED);

describe('makeIngesterListener', () => {
  it('#1 — decode succeeds → archiveWriter.write called with ctx and decoded event', async () => {
    const writer = makeWriter();
    const listener = makeIngesterListener(
      { archiveWriter: writer, context: CTX, logger: silentLogger, dlqRepo: makeDlqRepo() },
      decode,
    );
    const log = makeLog();

    await listener([log]);

    expect(writer.write as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    expect(writer.write as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(CTX, DECODED, log);
  });

  it('#2 — multiple logs processed sequentially', async () => {
    const order: number[] = [];
    const writer = makeWriter(() => {
      order.push(order.length);
      return Promise.resolve({ result: 'inserted' });
    });
    const listener = makeIngesterListener(
      { archiveWriter: writer, context: CTX, logger: silentLogger, dlqRepo: makeDlqRepo() },
      decode,
    );

    await listener([makeLog({ logIndex: 0 }), makeLog({ logIndex: 1 }), makeLog({ logIndex: 2 })]);
    expect(order).toEqual([0, 1, 2]);
  });

  it('#3 — decode throws DecodeError → DLQ inserted with stage=archive_decode, batch continues', async () => {
    const dlqRepo = makeDlqRepo();
    const badDecode = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new DecodeError('unknown_topic', null, {
          txHash: '0x',
          logIndex: 0,
          blockHash: '0x',
        });
      })
      .mockReturnValue(DECODED);
    const writer = makeWriter();
    const listener = makeIngesterListener(
      { archiveWriter: writer, context: CTX, logger: silentLogger, dlqRepo },
      badDecode,
    );

    await listener([makeLog({ logIndex: 0 }), makeLog({ logIndex: 1 })]);

    expect(dlqRepo.insert as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    const row = (dlqRepo.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(row.stage).toBe('archive_decode');
    expect(writer.write as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });

  it('#4 — decode throws plain Error → DLQ still routed with reason=unknown', async () => {
    const dlqRepo = makeDlqRepo();
    const badDecode = vi.fn().mockImplementation(() => {
      throw new Error('parse fail');
    });
    const listener = makeIngesterListener(
      { archiveWriter: makeWriter(), context: CTX, logger: silentLogger, dlqRepo },
      badDecode,
    );

    await listener([makeLog()]);
    expect(dlqRepo.insert as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });

  it('#5 — DLQ insert itself fails → batch still completes without throwing', async () => {
    const dlqRepo = {
      insert: vi.fn().mockRejectedValue(new Error('dlq down')),
    } as unknown as DlqRepository;
    const badDecode = vi.fn().mockImplementation(() => {
      throw new Error('bad');
    });
    const listener = makeIngesterListener(
      { archiveWriter: makeWriter(), context: CTX, logger: silentLogger, dlqRepo },
      badDecode,
    );

    await expect(listener([makeLog()])).resolves.not.toThrow();
  });

  it('#6 — write throws, onWriteFailure=swallow (default) → batch continues', async () => {
    let calls = 0;
    const writer = makeWriter(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('CH fail'));
      return Promise.resolve({ result: 'inserted' });
    });
    const listener = makeIngesterListener(
      { archiveWriter: writer, context: CTX, logger: silentLogger, dlqRepo: makeDlqRepo() },
      decode,
    );

    await expect(
      listener([makeLog({ logIndex: 0 }), makeLog({ logIndex: 1 })]),
    ).resolves.not.toThrow();
    expect(calls).toBe(2);
  });

  it('#7 — write throws, onWriteFailure=throw → error propagates', async () => {
    const writer = makeWriter(() => Promise.reject(new Error('CH fail')));
    const listener = makeIngesterListener(
      { archiveWriter: writer, context: CTX, logger: silentLogger, dlqRepo: makeDlqRepo() },
      decode,
      { onWriteFailure: 'throw' },
    );

    await expect(listener([makeLog()])).rejects.toThrow('CH fail');
  });

  it('#8 — empty batch completes without calling write', async () => {
    const writer = makeWriter();
    const listener = makeIngesterListener(
      { archiveWriter: writer, context: CTX, logger: silentLogger, dlqRepo: makeDlqRepo() },
      decode,
    );

    await listener([]);
    expect(writer.write as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
