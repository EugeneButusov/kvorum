import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { ArchiveWriteContext } from '@sources/core';
import { GovernorArchiveWriter } from './archive-writer';
import type { CompoundGovernorEvent } from '../domain/types';
import type { GovernorEventRepository } from '../persistence/event-repository';

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'compound_governor_bravo',
  chainId: 1,
  sourceLabel: 'compound_governor_bravo',
};

const DECODED: CompoundGovernorEvent = {
  type: 'ProposalCreated',
  payload: {
    proposalId: '123',
    proposer: '0xabcdef1234567890abcdef1234567890abcdef12',
    targets: ['0x1111111111111111111111111111111111111111'],
    values: ['0'],
    signatures: ['transfer(address,uint256)'],
    calldatas: ['0xdeadbeef'],
    startBlock: '18000000',
    endBlock: '18100000',
    description: 'test',
  },
};

const LOG_REF: LogEvent = {
  sourceType: 'compound_governor_bravo',
  chainId: 1,
  blockNumber: 20000000n,
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
  txIndex: 0,
  logIndex: 0,
  address: '0xc0da02939e1441f497fd74f78ce7decb17b66529',
  topics: ['0x7d84a6263ae0d98d3329bd7b46bb4e8d6f98cd35a7adb45c274c8b7fd5ebd5e0'],
  data: '0x',
};

function makeEventRepo(): GovernorEventRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
  } as unknown as GovernorEventRepository;
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

describe('GovernorArchiveWriter.insertEvent', () => {
  it('maps the decoded event into the source repository row', async () => {
    const eventRepo = makeEventRepo();
    const writer = new GovernorArchiveWriter({
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
