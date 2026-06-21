import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { SourceContext } from '@sources/core';
import { createLidoAragonVotingPlugin } from './plugin';
import { ARAGON_VOTING_INTERFACE, ARAGON_VOTING_TOPICS } from '../abi/events';
import { LidoAragonVotingArchiveWriter } from '../ingestion/archive-writer';
import * as ingesterListener from '../ingestion/ingester-listener';

const CTX: SourceContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aragon_voting',
  chainId: '0x1',
  sourceLabel: 'aragon_voting',
};

const VOTING_ADDRESS = '0x2e59A20f205bB85a89C53f1936454680651E618e';

const mockArchiveWriter = {
  writeCore: vi.fn().mockResolvedValue(undefined),
} as unknown as LidoAragonVotingArchiveWriter;

const mockDlqRepo = { insert: vi.fn() } as unknown as DlqRepository;

function makePlugin() {
  return createLidoAragonVotingPlugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

describe('createLidoAragonVotingPlugin', () => {
  it('uses sourceType aragon_voting and supports only mainnet', () => {
    const plugin = makePlugin();
    expect(plugin.sourceType).toBe('aragon_voting');
    expect(plugin.supportedChainIds).toEqual(['0x1']);
    expect(plugin.capabilities).toContain('backfillable');
  });

  it('parseConfig accepts voting_address and rejects invalid addresses', () => {
    const plugin = makePlugin();
    expect(plugin.parseConfig({ voting_address: VOTING_ADDRESS })).toEqual({
      voting_address: VOTING_ADDRESS,
    });
    expect(() => plugin.parseConfig({ governor_address: VOTING_ADDRESS })).toThrow();
    expect(() => plugin.parseConfig({ voting_address: 'not-an-address' })).toThrow();
  });

  it('buildIngestSpec lowercases the address and registers all 8 topics', () => {
    const plugin = makePlugin();
    const spec = plugin.buildIngestSpec(CTX, { voting_address: VOTING_ADDRESS });

    expect(spec.kind).toBe('evm-event-poller');
    expect(spec.filter.address).toBe(VOTING_ADDRESS.toLowerCase());
    expect(spec.filter.topics).toEqual([
      [
        ARAGON_VOTING_TOPICS.StartVote,
        ARAGON_VOTING_TOPICS.CastVote,
        ARAGON_VOTING_TOPICS.CastObjection,
        ARAGON_VOTING_TOPICS.ExecuteVote,
        ARAGON_VOTING_TOPICS.ChangeSupportRequired,
        ARAGON_VOTING_TOPICS.ChangeMinQuorum,
        ARAGON_VOTING_TOPICS.ChangeVoteTime,
        ARAGON_VOTING_TOPICS.ChangeObjectionPhaseTime,
      ],
    ]);
  });

  it('buildBackfillRuntime uses the ingester listener with onWriteFailure=throw', () => {
    const spy = vi.spyOn(ingesterListener, 'makeAragonVotingIngesterListener');
    const plugin = makePlugin();
    const runtime = plugin.buildBackfillRuntime(CTX, { voting_address: VOTING_ADDRESS });

    runtime.listenerFactory();
    expect(spy).toHaveBeenCalledWith(expect.any(Object), { onWriteFailure: 'throw' });
  });

  it('buildArchiveConsumer decodes RawLogJob and calls writeCore', async () => {
    const plugin = makePlugin();
    const consume = plugin.buildArchiveConsumer!();

    const fragment = ARAGON_VOTING_INTERFACE.getEvent('ExecuteVote')!;
    const encoded = ARAGON_VOTING_INTERFACE.encodeEventLog(fragment, [7n]);

    await consume(CTX, {
      chainId: '0x1',
      blockNumber: '11500000',
      blockHash: '0x' + 'ab'.repeat(32),
      txHash: '0x' + 'cd'.repeat(32),
      logIndex: 0,
      address: VOTING_ADDRESS.toLowerCase(),
      topics: encoded.topics as string[],
      data: encoded.data,
    });

    const writeCoreMock = mockArchiveWriter.writeCore as ReturnType<typeof vi.fn>;
    expect(writeCoreMock.mock.calls[0]?.[1]).toEqual({
      type: 'ExecuteVote',
      payload: { voteId: '7' },
    });
  });
});
