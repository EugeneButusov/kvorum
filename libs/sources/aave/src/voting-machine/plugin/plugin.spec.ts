import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { SourceContext } from '@sources/core';
import { createAaveVotingMachinePlugin } from './plugin';
import { AAVE_VOTING_MACHINE_TOPICS } from '../abi/events';
import { AaveVotingMachineArchiveWriter } from '../ingestion/archive-writer';
import * as ingesterListener from '../ingestion/ingester-listener';

const CTX: SourceContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_voting_machine',
  chainId: '0x89',
  sourceLabel: 'aave_voting_machine',
};

const mockArchiveWriter = {
  writeCore: vi.fn().mockResolvedValue(undefined),
} as unknown as AaveVotingMachineArchiveWriter;
const mockDlqRepo = { insert: vi.fn() } as unknown as DlqRepository;

function makePlugin() {
  return createAaveVotingMachinePlugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

describe('createAaveVotingMachinePlugin', () => {
  it('uses sourceType aave_voting_machine and supports the seeded chains', () => {
    const plugin = makePlugin();
    expect(plugin.sourceType).toBe('aave_voting_machine');
    expect(plugin.supportedChainIds).toEqual(['0x1', '0x89', '0xa86a']);
  });

  it('accepts voting_machine_address and rejects governor_address', () => {
    const plugin = makePlugin();
    expect(
      plugin.parseConfig({
        voting_machine_address: '0x44c8b753229006A8047A05b90379A7e92185E97C',
      }),
    ).toEqual({
      voting_machine_address: '0x44c8b753229006A8047A05b90379A7e92185E97C',
    });
    expect(() =>
      plugin.parseConfig({
        governor_address: '0x44c8b753229006A8047A05b90379A7e92185E97C',
      }),
    ).toThrow();
  });

  it('buildIngestSpec lowercases the address and registers all 4 topics', () => {
    const plugin = makePlugin();
    const spec = plugin.buildIngestSpec(CTX, {
      voting_machine_address: '0x44c8b753229006A8047A05b90379A7e92185E97C',
    });

    expect(spec.kind).toBe('evm-event-poller');
    expect(spec.filter.address).toBe('0x44c8b753229006a8047a05b90379a7e92185e97c');
    expect(spec.filter.topics).toEqual([
      [
        AAVE_VOTING_MACHINE_TOPICS.VoteEmitted,
        AAVE_VOTING_MACHINE_TOPICS.ProposalVoteStarted,
        AAVE_VOTING_MACHINE_TOPICS.ProposalResultsSent,
        AAVE_VOTING_MACHINE_TOPICS.ProposalVoteConfigurationBridged,
      ],
    ]);
  });

  it('buildBackfillRuntime uses the ingester listener with onWriteFailure=throw', () => {
    const spy = vi.spyOn(ingesterListener, 'makeAaveVotingMachineIngesterListener');
    const plugin = makePlugin();
    const runtime = plugin.buildBackfillRuntime(CTX, {
      voting_machine_address: '0x44c8b753229006A8047A05b90379A7e92185E97C',
    });

    runtime.listenerFactory();
    expect(spy).toHaveBeenCalledWith(expect.any(Object), { onWriteFailure: 'throw' });
  });

  it('buildArchiveConsumer decodes RawLogJob and calls writeCore', async () => {
    const plugin = makePlugin();
    const consume = plugin.buildArchiveConsumer!();

    await consume(CTX, {
      chainId: '0x89',
      blockNumber: '202',
      blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      logIndex: 1,
      address: '0x44c8b753229006a8047a05b90379a7e92185e97c',
      topics: [
        '0x57595374ff15e29915354c26ba858db8ad6934a534ba31596cd613581aa3b99c',
        '0x00000000000000000000000000000000000000000000000000000000000000ca',
      ],
      data: '0x000000000000000000000000000000000000000000000000000000000000000b0000000000000000000000000000000000000000000000000000000000000003',
    });

    expect((mockArchiveWriter.writeCore as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual({
      type: 'ProposalResultsSent',
      payload: { proposalId: '202', forVotes: '11', againstVotes: '3' },
    });
  });
});
