import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { SourceContext } from '@sources/core';
import { createLidoDualGovernancePlugin } from './plugin';
import { DUAL_GOVERNANCE_TOPICS, TIMELOCK_TOPICS, TIMELOCK_INTERFACE } from '../abi/events';
import { LidoDualGovernanceArchiveWriter } from '../ingestion/archive-writer';
import * as ingesterListener from '../ingestion/ingester-listener';

const CTX: SourceContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000002',
  sourceType: 'dual_governance',
  chainId: '0x1',
  sourceLabel: 'dual_governance',
};

const DG_ADDRESS = '0xC1db28B3301331277e307FDCfF8DE28242A4486E';
const TIMELOCK_ADDRESS = '0xCE0425301C85c5Ea2A0873A2dEe44d78E02D2316';
const CONFIG = { dual_governance_address: DG_ADDRESS, timelock_address: TIMELOCK_ADDRESS };

const mockArchiveWriter = {
  writeCore: vi.fn().mockResolvedValue(undefined),
} as unknown as LidoDualGovernanceArchiveWriter;

const mockDlqRepo = { insert: vi.fn() } as unknown as DlqRepository;

function makePlugin() {
  return createLidoDualGovernancePlugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

describe('createLidoDualGovernancePlugin', () => {
  it('uses sourceType dual_governance and supports only mainnet', () => {
    const plugin = makePlugin();
    expect(plugin.sourceType).toBe('dual_governance');
    expect(plugin.supportedChainIds).toEqual(['0x1']);
    expect(plugin.capabilities).toContain('backfillable');
  });

  it('parseConfig requires both addresses and rejects invalid ones', () => {
    const plugin = makePlugin();
    expect(plugin.parseConfig(CONFIG)).toEqual(CONFIG);
    expect(() => plugin.parseConfig({ dual_governance_address: DG_ADDRESS })).toThrow();
    expect(() =>
      plugin.parseConfig({ dual_governance_address: 'nope', timelock_address: TIMELOCK_ADDRESS }),
    ).toThrow();
  });

  it('buildIngestSpec watches both addresses (lowercased) with all DG + Timelock topics', () => {
    const plugin = makePlugin();
    const spec = plugin.buildIngestSpec(CTX, CONFIG);
    expect(spec.kind).toBe('evm-event-poller');
    expect(spec.filter.address).toEqual([DG_ADDRESS.toLowerCase(), TIMELOCK_ADDRESS.toLowerCase()]);
    const topics = spec.filter.topics?.[0] as string[];
    expect(topics).toEqual(
      expect.arrayContaining([
        DUAL_GOVERNANCE_TOPICS.DualGovernanceStateChanged,
        DUAL_GOVERNANCE_TOPICS.ProposalSubmittedMeta,
        TIMELOCK_TOPICS.ProposalSubmitted,
        TIMELOCK_TOPICS.ProposalsCancelledTill,
      ]),
    );
    // The two same-named ProposalSubmitted events have distinct topic0s — both present.
    expect(DUAL_GOVERNANCE_TOPICS.ProposalSubmittedMeta).not.toBe(
      TIMELOCK_TOPICS.ProposalSubmitted,
    );
  });

  it('buildBackfillRuntime uses the ingester listener with onWriteFailure=throw', () => {
    const spy = vi.spyOn(ingesterListener, 'makeDualGovernanceIngesterListener');
    const plugin = makePlugin();
    const runtime = plugin.buildBackfillRuntime(CTX, CONFIG);
    runtime.listenerFactory();
    expect(spy).toHaveBeenCalledWith(expect.any(Object), { onWriteFailure: 'throw' });
  });

  it('buildArchiveConsumer decodes a RawLogJob and calls writeCore', async () => {
    const plugin = makePlugin();
    const consume = plugin.buildArchiveConsumer!();
    const fragment = TIMELOCK_INTERFACE.getEvent('ProposalExecuted')!;
    const encoded = TIMELOCK_INTERFACE.encodeEventLog(fragment, [7n]);

    await consume(CTX, {
      chainId: '0x1',
      blockNumber: '23095800',
      blockHash: '0x' + 'ab'.repeat(32),
      txHash: '0x' + 'cd'.repeat(32),
      logIndex: 1,
      address: TIMELOCK_ADDRESS.toLowerCase(),
      topics: encoded.topics as string[],
      data: encoded.data,
    });

    const writeCoreMock = mockArchiveWriter.writeCore as ReturnType<typeof vi.fn>;
    expect(writeCoreMock.mock.calls[0]?.[1]).toEqual({
      type: 'ProposalExecuted',
      payload: { id: '7' },
    });
  });
});
