import { describe, it, expect, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { ArchiveWriteContext, IngesterListenerOptions } from '@sources/core';
import { CompTokenArchiveWriter } from './archive-writer';
import {
  makeCompTokenIngesterListener,
  type CompTokenIngesterListenerDeps,
} from './ingester-listener';
import { COMPOUND_COMP_TOKEN_INTERFACE } from '../abi/events';

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'compound_comp_token',
  chainId: '1',
  sourceLabel: 'compound_comp_token',
};

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'compound_comp_token',
    chainId: 1,
    blockNumber: 20000000n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
    txIndex: 0,
    logIndex: 0,
    address: '0xc00e94cb662c3520282e6f5717214004a7f26888',
    topics: [],
    data: '0x',
    ...overrides,
  };
}

function makeDlqRepo(): DlqRepository {
  return { insert: vi.fn().mockResolvedValue(undefined) } as never;
}

function makeDeps(
  writeImpl?: () => ReturnType<CompTokenArchiveWriter['write']>,
): CompTokenIngesterListenerDeps {
  const archiveWriter = {
    write: vi.fn().mockImplementation(writeImpl ?? (() => Promise.resolve({ result: 'inserted' }))),
  } as never as CompTokenArchiveWriter;

  return { archiveWriter, context: CTX, logger: silentLogger, dlqRepo: makeDlqRepo() };
}

describe('makeCompTokenIngesterListener', () => {
  it('decodes event and calls archive writer', async () => {
    const deps = makeDeps();
    const listener = makeCompTokenIngesterListener(deps);

    const encoded = COMPOUND_COMP_TOKEN_INTERFACE.encodeEventLog(
      COMPOUND_COMP_TOKEN_INTERFACE.getEvent('DelegateChanged')!,
      [
        '0x1111111111111111111111111111111111111111',
        '0x0000000000000000000000000000000000000000',
        '0x2222222222222222222222222222222222222222',
      ],
    );
    const log = makeLog({ topics: encoded.topics as string[], data: encoded.data });

    await listener([log]);
    expect(deps.archiveWriter.write as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });

  it('routes decode errors to DLQ and continues batch', async () => {
    const deps = makeDeps();
    const listener = makeCompTokenIngesterListener(deps);

    const badLog = makeLog({ topics: ['0x' + '00'.repeat(32)] });
    const encoded = COMPOUND_COMP_TOKEN_INTERFACE.encodeEventLog(
      COMPOUND_COMP_TOKEN_INTERFACE.getEvent('DelegateVotesChanged')!,
      ['0x1111111111111111111111111111111111111111', 5n, 9n],
    );
    const goodLog = makeLog({
      topics: encoded.topics as string[],
      data: encoded.data,
      logIndex: 1,
    });

    await listener([badLog, goodLog]);
    expect((deps.dlqRepo as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledOnce();
    expect(deps.archiveWriter.write as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });

  it('rethrows CH write failures when onWriteFailure=throw', async () => {
    const deps = makeDeps(() => Promise.reject(new Error('ch down')));
    const options: IngesterListenerOptions = { onWriteFailure: 'throw' };
    const listener = makeCompTokenIngesterListener(deps, options);

    const encoded = COMPOUND_COMP_TOKEN_INTERFACE.encodeEventLog(
      COMPOUND_COMP_TOKEN_INTERFACE.getEvent('DelegateVotesChanged')!,
      ['0x1111111111111111111111111111111111111111', 5n, 9n],
    );
    const log = makeLog({ topics: encoded.topics as string[], data: encoded.data });

    await expect(listener([log])).rejects.toThrow('ch down');
  });

  it('swallows CH write failures by default and processes rest', async () => {
    let calls = 0;
    const deps = makeDeps(() => {
      calls++;
      return calls === 1
        ? Promise.reject(new Error('ch down'))
        : Promise.resolve({ result: 'inserted' });
    });
    const listener = makeCompTokenIngesterListener(deps);

    const enc1 = COMPOUND_COMP_TOKEN_INTERFACE.encodeEventLog(
      COMPOUND_COMP_TOKEN_INTERFACE.getEvent('DelegateVotesChanged')!,
      ['0x1111111111111111111111111111111111111111', 5n, 9n],
    );
    const enc2 = COMPOUND_COMP_TOKEN_INTERFACE.encodeEventLog(
      COMPOUND_COMP_TOKEN_INTERFACE.getEvent('DelegateChanged')!,
      [
        '0x1111111111111111111111111111111111111111',
        '0x0000000000000000000000000000000000000000',
        '0x2222222222222222222222222222222222222222',
      ],
    );

    await expect(
      listener([
        makeLog({ topics: enc1.topics as string[], data: enc1.data, logIndex: 0 }),
        makeLog({ topics: enc2.topics as string[], data: enc2.data, logIndex: 1 }),
      ]),
    ).resolves.not.toThrow();
    expect(calls).toBe(2);
  });
});
