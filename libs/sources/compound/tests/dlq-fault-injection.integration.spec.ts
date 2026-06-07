import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Interface } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import type { ArchiveEventRepository, DlqRepository } from '@libs/db';
import type { ArchiveWriteContext } from '@sources/core';
import { CompTokenArchiveWriter } from '../src/comp-token/ingestion/archive-writer';
import { makeCompTokenIngesterListener } from '../src/comp-token/ingestion/ingester-listener';
import type { CompTokenEventRepository } from '../src/comp-token/persistence/event-repository';
import type { CompoundGovernorEvent } from '../src/governor/domain/types';
import { GovernorArchiveWriter } from '../src/governor/ingestion/archive-writer';
import { makeGovernorIngesterListener } from '../src/governor/ingestion/ingester-listener';
import type { GovernorEventRepository } from '../src/governor/persistence/event-repository';

type FixtureLog = {
  variant: 'compound_governor_alpha' | 'compound_governor_bravo' | 'compound_governor_oz';
  txHash: string;
  blockHash: string;
  logIndex: number;
  blockNumber: string;
  address: string;
  topics: string[];
  data: string;
};

const GOV_CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'compound_governor_bravo',
  chainId: 1,
  sourceLabel: 'compound_governor_bravo',
  confirmationClassifier: () => 'confirmed',
};

const COMP_CTX: ArchiveWriteContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000002',
  sourceType: 'compound_comp_token',
  chainId: 1,
  sourceLabel: 'compound_comp_token',
  confirmationClassifier: () => 'confirmed',
};

function makeConfirmationRepo(shouldFail: boolean): ArchiveEventRepository {
  return {
    find: vi.fn().mockResolvedValue(undefined),
    insert: shouldFail
      ? vi.fn().mockRejectedValue(new Error('forced pg failure'))
      : vi.fn().mockResolvedValue({ id: 'ok' }),
  } as unknown as ArchiveEventRepository;
}

function makeGovEventRepo(shouldFail: boolean): GovernorEventRepository {
  return {
    insert: shouldFail ? vi.fn().mockRejectedValue(new Error('forced ch failure')) : vi.fn(),
  } as unknown as EventRepository;
}

function makeCompEventRepo(shouldFail: boolean): CompTokenEventRepository {
  return {
    insert: shouldFail ? vi.fn().mockRejectedValue(new Error('forced ch failure')) : vi.fn(),
  } as unknown as CompTokenEventRepository;
}

function makeDlqRepo(capture: Array<{ stage: string; payload: unknown }>): DlqRepository {
  return {
    insert: vi.fn().mockImplementation((row: { stage: string; payload: unknown }) => {
      capture.push({ stage: row.stage, payload: row.payload });
      return Promise.resolve(undefined);
    }),
  } as unknown as DlqRepository;
}

function fixtureVoteCastLog(): LogEvent {
  const fixturePath = join(__dirname, 'fixtures', 'logs', 'votecast-mainnet-fixture.json');
  const item = (JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureLog[]).find(
    (row) => row.variant === 'compound_governor_bravo',
  );
  if (!item) {
    throw new Error('missing compound_governor_bravo VoteCast fixture');
  }
  return {
    sourceType: item.variant,
    chainId: 1,
    blockNumber: BigInt(item.blockNumber),
    blockHash: item.blockHash,
    txHash: item.txHash,
    txIndex: 0,
    logIndex: item.logIndex,
    address: item.address,
    topics: item.topics,
    data: item.data,
  };
}

function compTokenDelegateVotesChangedLog(): LogEvent {
  const iface = new Interface([
    'event DelegateVotesChanged(address indexed delegate, uint256 previousVotes, uint256 newVotes)',
  ]);
  const event = iface.getEvent('DelegateVotesChanged')!;
  const encoded = iface.encodeEventLog(event, ['0x' + 'ab'.repeat(20), 123n, 456n]);

  return {
    sourceType: 'compound_comp_token',
    chainId: 1,
    blockNumber: 21_000_000n,
    blockHash: '0x' + '11'.repeat(32),
    txHash: '0x' + '22'.repeat(32),
    txIndex: 0,
    logIndex: 0,
    address: '0x' + '33'.repeat(20),
    topics: encoded.topics.map((x) => x.toLowerCase()),
    data: encoded.data,
  };
}

describe('DLQ fault injection integration', () => {
  it('routes governor VoteCast PG failure to vote_archive_write', async () => {
    const dlqRows: Array<{ stage: string; payload: unknown }> = [];
    const writer = new GovernorArchiveWriter({
      eventRepo: makeGovEventRepo(false),
      archiveEventRepo: makeConfirmationRepo(true),
      dlqRepo: makeDlqRepo(dlqRows),
      logger: silentLogger,
    });
    const listener = makeGovernorIngesterListener(
      { archiveWriter: writer, context: GOV_CTX, logger: silentLogger, dlqRepo: makeDlqRepo([]) },
      { onWriteFailure: 'throw' },
    );

    await listener([fixtureVoteCastLog()]);

    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0]!.stage).toBe('archive_event_stage');
  });

  it('routes governor proposal PG failure to archive_event_write', async () => {
    const dlqRows: Array<{ stage: string; payload: unknown }> = [];
    const writer = new GovernorArchiveWriter({
      eventRepo: makeGovEventRepo(false),
      archiveEventRepo: makeConfirmationRepo(true),
      dlqRepo: makeDlqRepo(dlqRows),
      logger: silentLogger,
    });

    const decoded: CompoundGovernorEvent = {
      type: 'ProposalQueued',
      payload: { proposalId: '1', eta: '123' },
    };
    const logRef: LogEvent = {
      sourceType: 'compound_governor_bravo',
      chainId: 1,
      blockNumber: 20_000_001n,
      blockHash: '0x' + '44'.repeat(32),
      txHash: '0x' + '55'.repeat(32),
      txIndex: 0,
      logIndex: 0,
      address: '0x' + '66'.repeat(20),
      topics: ['0x' + '77'.repeat(32)],
      data: '0x',
    };

    const outcome = await writer.write(GOV_CTX, decoded, logRef);
    expect(outcome.result).toBe('dlq_routed');
    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0]!.stage).toBe('archive_event_stage');
  });

  it('routes governor VoteCast CH failure to vote_archive_write', async () => {
    const dlqRows: Array<{ stage: string; payload: unknown }> = [];
    const writer = new GovernorArchiveWriter({
      eventRepo: makeGovEventRepo(true),
      archiveEventRepo: makeConfirmationRepo(false),
      dlqRepo: makeDlqRepo(dlqRows),
      logger: silentLogger,
    });
    const listener = makeGovernorIngesterListener(
      { archiveWriter: writer, context: GOV_CTX, logger: silentLogger, dlqRepo: makeDlqRepo([]) },
      { onWriteFailure: 'throw' },
    );

    await listener([fixtureVoteCastLog()]);

    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0]!.stage).toBe('archive_event_stage');
  });

  it('routes comp-token archive failure to delegation_archive_write', async () => {
    const dlqRows: Array<{ stage: string; payload: unknown }> = [];
    const writer = new CompTokenArchiveWriter({
      eventRepo: makeCompEventRepo(true),
      archiveEventRepo: makeConfirmationRepo(false),
      dlqRepo: makeDlqRepo(dlqRows),
      logger: silentLogger,
    });
    const listener = makeCompTokenIngesterListener(
      { archiveWriter: writer, context: COMP_CTX, logger: silentLogger, dlqRepo: makeDlqRepo([]) },
      { onWriteFailure: 'throw' },
    );

    await listener([compTokenDelegateVotesChangedLog()]);

    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0]!.stage).toBe('delegation_archive_stage');
  });
});
