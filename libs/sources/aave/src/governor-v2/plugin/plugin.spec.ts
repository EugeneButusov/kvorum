import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { SourceContext } from '@sources/core';
import { createAaveGovernorV2Plugin } from './plugin';
import { AAVE_GOVERNOR_V2_TOPICS } from '../abi/events';
import { AaveGovernorV2ArchiveWriter } from '../ingestion/archive-writer';
import * as ingesterListener from '../ingestion/ingester-listener';

const CTX: SourceContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_governor_v2',
  chainId: '0x1',
  sourceLabel: 'aave_governor_v2',
};

const GOVERNOR_ADDR = '0xEC568fffba86c094cf06b22134B23074DFE2252c';

const mockArchiveWriter = {
  writeCore: vi.fn().mockResolvedValue(undefined),
} as unknown as AaveGovernorV2ArchiveWriter;
const mockDlqRepo = { insert: vi.fn() } as unknown as DlqRepository;

function makePlugin() {
  return createAaveGovernorV2Plugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

describe('createAaveGovernorV2Plugin', () => {
  it('uses sourceType aave_governor_v2 and supports mainnet only', () => {
    const plugin = makePlugin();
    expect(plugin.sourceType).toBe('aave_governor_v2');
    expect(plugin.supportedChainIds).toEqual(['0x1']);
  });

  it('accepts governor_address and rejects governance_address', () => {
    const plugin = makePlugin();
    expect(plugin.parseConfig({ governor_address: GOVERNOR_ADDR })).toEqual({
      governor_address: GOVERNOR_ADDR,
    });
    expect(() => plugin.parseConfig({ governance_address: GOVERNOR_ADDR })).toThrow();
  });

  it('rejects invalid addresses', () => {
    const plugin = makePlugin();
    expect(() => plugin.parseConfig({ governor_address: 'not-an-address' })).toThrow();
    expect(() => plugin.parseConfig({ governor_address: '0x123' })).toThrow();
  });

  it('buildIngestSpec lowercases the address and registers all 5 topics', () => {
    const plugin = makePlugin();
    const spec = plugin.buildIngestSpec(CTX, { governor_address: GOVERNOR_ADDR });

    expect(spec.kind).toBe('evm-event-poller');
    expect(spec.filter.address).toBe(GOVERNOR_ADDR.toLowerCase());
    expect(spec.filter.topics).toEqual([
      [
        AAVE_GOVERNOR_V2_TOPICS.ProposalCreated,
        AAVE_GOVERNOR_V2_TOPICS.VoteEmitted,
        AAVE_GOVERNOR_V2_TOPICS.ProposalQueued,
        AAVE_GOVERNOR_V2_TOPICS.ProposalExecuted,
        AAVE_GOVERNOR_V2_TOPICS.ProposalCanceled,
      ],
    ]);
  });

  it('buildBackfillRuntime uses ingester listener with onWriteFailure=throw', () => {
    const spy = vi.spyOn(ingesterListener, 'makeAaveGovernorV2IngesterListener');
    const plugin = makePlugin();
    const runtime = plugin.buildBackfillRuntime(CTX, { governor_address: GOVERNOR_ADDR });

    runtime.listenerFactory();
    expect(spy).toHaveBeenCalledWith(expect.any(Object), { onWriteFailure: 'throw' });
  });

  it('buildArchiveConsumer decodes and calls writeCore with the correct event', async () => {
    const plugin = makePlugin();
    const consume = plugin.buildArchiveConsumer!();

    const { AAVE_GOVERNOR_V2_INTERFACE } = await import('../abi/events');
    const encoded = AAVE_GOVERNOR_V2_INTERFACE.encodeEventLog(
      AAVE_GOVERNOR_V2_INTERFACE.getEvent('ProposalCanceled')!,
      [42n],
    );

    await consume(CTX, {
      chainId: '0x1',
      blockNumber: '12000001',
      blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      logIndex: 0,
      address: GOVERNOR_ADDR.toLowerCase(),
      topics: encoded.topics as string[],
      data: encoded.data,
    });

    expect((mockArchiveWriter.writeCore as ReturnType<typeof vi.fn>).mock.lastCall?.[1]).toEqual({
      type: 'ProposalCanceled',
      payload: { id: '42' },
    });
  });
});
