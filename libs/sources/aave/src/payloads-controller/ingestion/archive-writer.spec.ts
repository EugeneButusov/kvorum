import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import { AavePayloadsControllerArchiveWriter } from './archive-writer';
import type { ArchiveWriteContext } from './archive-writer.types';
import type { AavePayloadsControllerEvent } from '../domain/types';
import type { AavePayloadsControllerEventRepository } from '../persistence/event-repository';

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_payloads_controller',
  chainId: '0x1',
  sourceLabel: 'aave_payloads_controller',
};

const DECODED: AavePayloadsControllerEvent = {
  type: 'PayloadCreated',
  payload: {
    payloadId: '321',
    creator: '0x1234567890abcdef1234567890abcdef12345678',
    maximumAccessLevelRequired: 2,
    actions: [
      {
        target: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        withDelegateCall: true,
        accessLevel: 2,
        value: '9007199254741115',
        signature: 'execute(uint256,address)',
        callData: '0x1234abcd',
      },
    ],
  },
};

const LOG_REF: LogEvent = {
  sourceType: 'aave_payloads_controller',
  chainId: '0x1',
  blockNumber: 23000000n,
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  txIndex: 0,
  logIndex: 0,
  address: '0xdabad81af85554e9ae636395611c58f7ec1aaec5',
  topics: ['0x1e4588da4731f84a598f061ee45829a6450aa00aa28962657b6835641afbbac5'],
  data: '0x' + '12'.repeat(32),
};

function makeEventRepo(): AavePayloadsControllerEventRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
  } as unknown as AavePayloadsControllerEventRepository;
}

function makeArchiveEventRepo(): ArchiveEventRepository {
  return {
    find: vi.fn(),
    insert: vi.fn().mockResolvedValue({ id: 'uuid-1' }),
  } as unknown as ArchiveEventRepository;
}

function makeDlqRepo(): DlqRepository {
  return {
    insert: vi.fn(),
  } as unknown as DlqRepository;
}

describe('AavePayloadsControllerArchiveWriter.insertEvent', () => {
  it('maps the decoded event into the source repository row without received_at', async () => {
    const eventRepo = makeEventRepo();
    const archiveEventRepo = makeArchiveEventRepo();
    const writer = new AavePayloadsControllerArchiveWriter({
      eventRepo,
      archiveEventRepo,
      dlqRepo: makeDlqRepo(),
      logger: silentLogger,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    await writer.writeCore(CTX, DECODED, LOG_REF);

    expect(eventRepo.insert).toHaveBeenCalledWith({
      daoSourceId: CTX.daoSourceId,
      chainId: CTX.chainId,
      blockNumber: LOG_REF.blockNumber.toString(),
      blockHash: LOG_REF.blockHash,
      txHash: LOG_REF.txHash,
      logIndex: LOG_REF.logIndex,
      eventType: DECODED.type,
      payload: JSON.stringify(DECODED.payload),
    });
    expect(
      Object.keys((eventRepo.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0]),
    ).not.toContain('received_at');
    expect(archiveEventRepo.insert).toHaveBeenCalledOnce();
  });
});
