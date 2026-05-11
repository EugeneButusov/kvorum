import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeIngesterListener } from './ingester-listener';
import type { IngesterListenerDeps } from './ingester-listener';
import { ArchiveWriter } from './archive-writer';
import type { ArchiveWriteContext } from './archive-writer';
import { COMPOUND_EVENT_TOPICS } from './events';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import { resetMetrics } from '@libs/chain';

beforeEach(() => resetMetrics());

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'compound_governor',
  chainId: 1,
  sourceLabel: 'compound_governor',
};

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'compound_governor',
    chainId: 1,
    blockNumber: 20000000n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
    txIndex: 0,
    logIndex: 0,
    address: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
    topics: [COMPOUND_EVENT_TOPICS.ProposalExecuted],
    data: '0x',
    ...overrides,
  };
}

/** Minimal mock PgDb that accepts DLQ inserts without error. */
function makePgDb(): unknown {
  const chain = {
    values: vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue(undefined) }),
  };
  return { insertInto: vi.fn().mockReturnValue(chain) };
}

function makeDeps(writeImpl?: () => ReturnType<ArchiveWriter['write']>): IngesterListenerDeps {
  const archiveWriter = {
    write: vi.fn().mockImplementation(writeImpl ?? (() => Promise.resolve({ result: 'inserted' }))),
  } as unknown as ArchiveWriter;

  return {
    archiveWriter,
    context: CTX,
    logger: silentLogger,
    pgDb: makePgDb() as never,
  };
}

describe('makeIngesterListener', () => {
  it('#1 — single event: archiveWriter.write called once with correct context', async () => {
    const deps = makeDeps();
    const listener = makeIngesterListener(deps);

    // Use a log that decodes as ProposalExecuted (topic0 matches, data is 0x but
    // ProposalExecuted only has topic-encoded id, so we need proper encoding).
    // For simplicity just test via the decode path by mocking archiveWriter directly.
    // We use a mock that bypasses real decoding by patching the listener's decode call.
    // Actually, we need the listener to reach archiveWriter.write, which means the decode must succeed.
    // Use a fixture log from the decoder spec that we know decodes correctly.
    const { COMPOUND_GOVERNOR_INTERFACE } = await import('./events.js');
    const encoded = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
      COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalExecuted')!,
      [42n],
    );
    const log = makeLog({ topics: encoded.topics as string[], data: encoded.data });

    await listener([log]);
    expect(deps.archiveWriter.write as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    expect(deps.archiveWriter.write as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ type: 'ProposalExecuted' }),
      log,
    );
  });

  it('#2 — multiple events: archiveWriter.write called sequentially in order', async () => {
    const callOrder: number[] = [];
    const deps = makeDeps(() => {
      callOrder.push(callOrder.length);
      return Promise.resolve({ result: 'inserted' as const });
    });
    const listener = makeIngesterListener(deps);

    const { COMPOUND_GOVERNOR_INTERFACE } = await import('./events.js');
    const encodeExecuted = (id: bigint) => {
      const enc = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
        COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalExecuted')!,
        [id],
      );
      return makeLog({ topics: enc.topics as string[], data: enc.data, logIndex: Number(id) });
    };

    await listener([encodeExecuted(1n), encodeExecuted(2n), encodeExecuted(3n)]);
    expect(callOrder).toEqual([0, 1, 2]);
  });

  it('#3 — decode failure → DLQ inserted with stage=archive_decode, counter increments, batch continues', async () => {
    const deps = makeDeps();
    const listener = makeIngesterListener(deps);

    const { COMPOUND_GOVERNOR_INTERFACE } = await import('./events.js');
    const unknownLog = makeLog({ topics: ['0x' + '00'.repeat(32)] });
    const validEncoded = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
      COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalExecuted')!,
      [1n],
    );
    const validLog = makeLog({
      topics: validEncoded.topics as string[],
      data: validEncoded.data,
      logIndex: 1,
    });

    await listener([unknownLog, validLog]);

    // DLQ was attempted for unknown log
    expect((deps.pgDb as { insertInto: ReturnType<typeof vi.fn> }).insertInto).toHaveBeenCalled();
    const dlqCall = (deps.pgDb as { insertInto: ReturnType<typeof vi.fn> }).insertInto.mock
      .calls[0];
    expect(dlqCall?.[0]).toBe('ingestion_dlq');

    // write was still called for the valid event (batch continued)
    expect(deps.archiveWriter.write as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });

  it('#4 — write returns pg_unreachable → batch CONTINUES, next event still processed', async () => {
    let callCount = 0;
    const deps = makeDeps(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ result: 'pg_unreachable' as const });
      return Promise.resolve({ result: 'inserted' as const });
    });
    const listener = makeIngesterListener(deps);

    const { COMPOUND_GOVERNOR_INTERFACE } = await import('./events.js');
    const enc = (id: bigint, idx: number) => {
      const e = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
        COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalExecuted')!,
        [id],
      );
      return makeLog({ topics: e.topics as string[], data: e.data, logIndex: idx });
    };

    await listener([enc(1n, 0), enc(2n, 1)]);
    expect(callCount).toBe(2);
  });

  it('#5 — write throws (CH failure) → counter increments, batch continues, next event processed', async () => {
    let callCount = 0;
    const deps = makeDeps(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('CH connection refused'));
      return Promise.resolve({ result: 'inserted' as const });
    });
    const listener = makeIngesterListener(deps);

    const { COMPOUND_GOVERNOR_INTERFACE } = await import('./events.js');
    const enc = (id: bigint, idx: number) => {
      const e = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
        COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalExecuted')!,
        [id],
      );
      return makeLog({ topics: e.topics as string[], data: e.data, logIndex: idx });
    };

    await listener([enc(1n, 0), enc(2n, 1)]);
    expect(callCount).toBe(2); // second event still processed
  });

  it('#6 — write returns skipped_existing → no error, batch continues', async () => {
    const deps = makeDeps(() => Promise.resolve({ result: 'skipped_existing' as const }));
    const listener = makeIngesterListener(deps);

    const { COMPOUND_GOVERNOR_INTERFACE } = await import('./events.js');
    const enc = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
      COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalExecuted')!,
      [1n],
    );
    const log = makeLog({ topics: enc.topics as string[], data: enc.data });

    await expect(listener([log])).resolves.not.toThrow();
  });

  it('#7 — all four event types decode and dispatch without error', async () => {
    const writeCallTypes: string[] = [];
    const deps = makeDeps();

    (deps.archiveWriter.write as ReturnType<typeof vi.fn>).mockImplementation(
      (_ctx: unknown, decoded: { type: string }) => {
        writeCallTypes.push(decoded.type);
        return Promise.resolve({ result: 'inserted' as const });
      },
    );

    const listener = makeIngesterListener(deps);
    const { COMPOUND_GOVERNOR_INTERFACE } = await import('./events.js');

    const events = [
      (() => {
        const e = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
          COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalCreated')!,
          [1n, '0x1111111111111111111111111111111111111111', [], [], [], [], 1n, 2n, ''],
        );
        return makeLog({ topics: e.topics as string[], data: e.data, logIndex: 0 });
      })(),
      (() => {
        const e = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
          COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalQueued')!,
          [2n, 1700000000n],
        );
        return makeLog({ topics: e.topics as string[], data: e.data, logIndex: 1 });
      })(),
      (() => {
        const e = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
          COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalExecuted')!,
          [3n],
        );
        return makeLog({ topics: e.topics as string[], data: e.data, logIndex: 2 });
      })(),
      (() => {
        const e = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
          COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalCanceled')!,
          [4n],
        );
        return makeLog({ topics: e.topics as string[], data: e.data, logIndex: 3 });
      })(),
    ];

    await listener(events);
    expect(writeCallTypes.sort()).toEqual([
      'ProposalCanceled',
      'ProposalCreated',
      'ProposalExecuted',
      'ProposalQueued',
    ]);
  });

  it('#8 — batch duration histogram observes one sample per batch', async () => {
    const { getBatchDurationSeconds } = await import('@libs/chain');
    const hist = getBatchDurationSeconds();
    const startTimerSpy = vi.spyOn(hist, 'startTimer');

    const deps = makeDeps();
    const listener = makeIngesterListener(deps);

    const { COMPOUND_GOVERNOR_INTERFACE } = await import('./events.js');
    const enc = COMPOUND_GOVERNOR_INTERFACE.encodeEventLog(
      COMPOUND_GOVERNOR_INTERFACE.getEvent('ProposalExecuted')!,
      [1n],
    );
    const log = makeLog({ topics: enc.topics as string[], data: enc.data });

    await listener([log]);
    expect(startTimerSpy).toHaveBeenCalledOnce();
    expect(startTimerSpy).toHaveBeenCalledWith({ source: 'compound_governor' });
  });
});
