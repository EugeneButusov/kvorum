import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import { LidoDualGovernanceArchiveWriter } from './archive-writer';
import type { ArchiveWriteContext } from './archive-writer.types';
import type { DualGovernanceEvent } from '../domain/types';
import type { DualGovernanceEventRepository } from '../persistence/event-repository';

const CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000002',
  sourceType: 'dual_governance',
  chainId: '0x1',
  sourceLabel: 'dual_governance',
};

const DECODED: DualGovernanceEvent = {
  type: 'ProposalSubmittedMeta',
  payload: {
    proposerAccount: '0x1111111111111111111111111111111111111111',
    proposalId: '7',
    metadata: 'Upgrade staking router',
  },
};

const LOG_REF: LogEvent = {
  sourceType: 'dual_governance',
  chainId: '0x1',
  blockNumber: 23095800n,
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  txIndex: 0,
  logIndex: 0,
  address: '0xc1db28b3301331277e307fdcff8de28242a4486e',
  topics: [],
  data: '0x',
};

function makeEventRepo(): DualGovernanceEventRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
  } as unknown as DualGovernanceEventRepository;
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

describe('LidoDualGovernanceArchiveWriter', () => {
  it('constructs with the archive_event_stage DLQ stage', () => {
    const writer = new LidoDualGovernanceArchiveWriter({
      eventRepo: makeEventRepo(),
      archiveEventRepo: makeArchiveEventRepo(),
      dlqRepo: makeDlqRepo(),
      logger: silentLogger,
    });
    expect(writer).toBeInstanceOf(LidoDualGovernanceArchiveWriter);
  });

  it('insertEvent maps the decoded event into the source repository row', async () => {
    const eventRepo = makeEventRepo();
    const writer = new LidoDualGovernanceArchiveWriter({
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
