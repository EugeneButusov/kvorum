import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import { AaveVotingMachineArchiveWriter } from './archive-writer';
import type { ArchiveWriteContext } from './archive-writer.types';
import {
  type AaveVotingMachineIngesterListenerDeps,
  makeAaveVotingMachineIngesterListener,
} from './ingester-listener';
import * as decoder from '../abi/decoder';
import { AAVE_VOTING_MACHINE_INTERFACE } from '../abi/events';

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_voting_machine',
  chainId: '0x89',
  sourceLabel: 'aave_voting_machine',
};

function makeLog(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    sourceType: 'aave_voting_machine',
    chainId: '0x89',
    blockNumber: 69000000n,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    txIndex: 0,
    logIndex: 0,
    address: '0x44c8b753229006a8047a05b90379a7e92185e97c',
    topics: [],
    data: '0x',
    ...overrides,
  };
}

function makeDlqRepo(): DlqRepository {
  return { insert: vi.fn().mockResolvedValue(undefined) } as unknown as DlqRepository;
}

function makeDeps(
  writeImpl?: () => ReturnType<AaveVotingMachineArchiveWriter['write']>,
): AaveVotingMachineIngesterListenerDeps {
  const archiveWriter = {
    write: vi.fn().mockImplementation(writeImpl ?? (() => Promise.resolve({ result: 'inserted' }))),
  } as unknown as AaveVotingMachineArchiveWriter;

  return {
    archiveWriter,
    context: CTX,
    logger: silentLogger,
    dlqRepo: makeDlqRepo(),
  };
}

describe('makeAaveVotingMachineIngesterListener', () => {
  it('decodes valid events and forwards them to archiveWriter.write', async () => {
    const deps = makeDeps();
    const listener = makeAaveVotingMachineIngesterListener(deps);
    const encoded = AAVE_VOTING_MACHINE_INTERFACE.encodeEventLog(
      AAVE_VOTING_MACHINE_INTERFACE.getEvent('ProposalResultsSent')!,
      [42n, 11n, 3n],
    );
    const log = makeLog({ topics: encoded.topics as string[], data: encoded.data });

    await listener([log]);

    expect(deps.archiveWriter.write as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ type: 'ProposalResultsSent' }),
      log,
    );
  });

  it('routes decode failures to archive_decode DLQ and continues', async () => {
    const deps = makeDeps();
    const listener = makeAaveVotingMachineIngesterListener(deps);
    const valid = AAVE_VOTING_MACHINE_INTERFACE.encodeEventLog(
      AAVE_VOTING_MACHINE_INTERFACE.getEvent('ProposalResultsSent')!,
      [1n, 2n, 3n],
    );

    await listener([
      makeLog({ topics: ['0x' + '00'.repeat(32)] }),
      makeLog({ topics: valid.topics as string[], data: valid.data, logIndex: 1 }),
    ]);

    expect((deps.dlqRepo as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledOnce();
    expect(deps.archiveWriter.write as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });

  it('logs decode DLQ insert failures and handles unknown decode errors', async () => {
    const deps = makeDeps();
    const insert = vi.fn().mockRejectedValue(new Error('dlq down'));
    const logger = {
      ...silentLogger,
      error: vi.fn(),
    };
    const listener = makeAaveVotingMachineIngesterListener({
      ...deps,
      dlqRepo: { insert } as unknown as DlqRepository,
      logger,
    });

    await listener([makeLog({ topics: ['0x' + '00'.repeat(32)] })]);

    expect(insert).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      'decode_error_dlq_insert_failed',
      expect.objectContaining({
        originalError: expect.any(String),
        dlqError: 'Error: dlq down',
      }),
    );
  });

  it('classifies non-DecodeError failures with reason unknown', async () => {
    const decodeSpy = vi.spyOn(decoder, 'decodeAaveVotingMachineLog').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const insert = vi.fn().mockResolvedValue(undefined);
    const logger = {
      ...silentLogger,
      error: vi.fn(),
    };
    const listener = makeAaveVotingMachineIngesterListener({
      ...makeDeps(),
      dlqRepo: { insert } as unknown as DlqRepository,
      logger,
    });

    await listener([makeLog({ topics: ['0x' + '00'.repeat(32)] })]);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ reason: 'unknown' }),
      }),
    );
    decodeSpy.mockRestore();
  });

  it('rethrows write failures when onWriteFailure=throw', async () => {
    const deps = makeDeps(() => Promise.reject(new Error('ch down')));
    const listener = makeAaveVotingMachineIngesterListener(deps, { onWriteFailure: 'throw' });
    const encoded = AAVE_VOTING_MACHINE_INTERFACE.encodeEventLog(
      AAVE_VOTING_MACHINE_INTERFACE.getEvent('ProposalResultsSent')!,
      [1n, 2n, 3n],
    );

    await expect(
      listener([makeLog({ topics: encoded.topics as string[], data: encoded.data })]),
    ).rejects.toThrow('ch down');
  });

  it('swallows write failures by default and continues the batch', async () => {
    let calls = 0;
    const deps = makeDeps(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('ch down'));
      return Promise.resolve({ result: 'inserted' as const });
    });
    const listener = makeAaveVotingMachineIngesterListener(deps);
    const encoded = AAVE_VOTING_MACHINE_INTERFACE.encodeEventLog(
      AAVE_VOTING_MACHINE_INTERFACE.getEvent('ProposalResultsSent')!,
      [1n, 2n, 3n],
    );

    await listener([
      makeLog({ topics: encoded.topics as string[], data: encoded.data }),
      makeLog({ topics: encoded.topics as string[], data: encoded.data, logIndex: 1 }),
    ]);

    expect(calls).toBe(2);
  });
});
