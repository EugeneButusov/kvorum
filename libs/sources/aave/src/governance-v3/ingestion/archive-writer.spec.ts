import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import { AaveGovernanceArchiveWriter } from './archive-writer';
import type { ArchiveWriteContext } from './archive-writer.types';
import type { AaveGovernanceV3Event } from '../domain/types';
import type { AaveGovernanceEventRepository } from '../persistence/event-repository';

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_governance_v3',
  chainId: '0x1',
  sourceLabel: 'aave_governance_v3',
};

const DECODED: AaveGovernanceV3Event = {
  type: 'ProposalCreated',
  payload: {
    proposalId: '123',
    creator: '0xabcdef1234567890abcdef1234567890abcdef12',
    accessLevel: 1,
    ipfsHash: '0x' + '12'.repeat(32),
  },
};

const LOG_REF: LogEvent = {
  sourceType: 'aave_governance_v3',
  chainId: '0x1',
  blockNumber: 20000000n,
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  txIndex: 0,
  logIndex: 0,
  address: '0x9aee0b04504cef83a65ac3f0e838d0593bcb2bc7',
  topics: ['0xcc914becfa276bbc067049bf8db2d34ebbdc1bafa851e4d4936aaed376c08dbe'],
  data: '0x' + '12'.repeat(32),
};

function makeEventRepo(): AaveGovernanceEventRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
  } as unknown as AaveGovernanceEventRepository;
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

describe('AaveGovernanceArchiveWriter.insertEvent', () => {
  it('maps the decoded event into the source repository row', async () => {
    const eventRepo = makeEventRepo();
    const writer = new AaveGovernanceArchiveWriter({
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
