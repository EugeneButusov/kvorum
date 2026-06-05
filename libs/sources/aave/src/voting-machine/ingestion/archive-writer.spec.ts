import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import { AaveVotingMachineArchiveWriter } from './archive-writer';
import type { ArchiveWriteContext } from './archive-writer.types';
import type { AaveVotingMachineEvent } from '../domain/types';
import type { AaveVotingMachineEventRepository } from '../persistence/event-repository';

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_voting_machine',
  chainId: '0x89',
  sourceLabel: 'aave_voting_machine',
};

const DECODED: AaveVotingMachineEvent = {
  type: 'VoteEmitted',
  payload: {
    proposalId: '123',
    voter: '0xabcdef1234567890abcdef1234567890abcdef12',
    support: true,
    votingPower: '456',
  },
};

const LOG_REF: LogEvent = {
  sourceType: 'aave_voting_machine',
  chainId: '0x89',
  blockNumber: 69000000n,
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  txIndex: 0,
  logIndex: 0,
  address: '0x44c8b753229006a8047a05b90379a7e92185e97c',
  topics: ['0x0c611e7b6ae0de26f4772260e1bbdb5f58cbb7c275fe2de14671968d29add8d6'],
  data: '0x' + '12'.repeat(32),
};

function makeEventRepo(): AaveVotingMachineEventRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
  } as unknown as AaveVotingMachineEventRepository;
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

describe('AaveVotingMachineArchiveWriter.insertEvent', () => {
  it('maps the decoded event into the source repository row', async () => {
    const eventRepo = makeEventRepo();
    const writer = new AaveVotingMachineArchiveWriter({
      eventRepo,
      archiveEventRepo: makeArchiveEventRepo(),
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
  });
});
