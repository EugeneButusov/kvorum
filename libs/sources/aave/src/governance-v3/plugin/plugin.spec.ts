import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { SourceContext } from '@sources/core';
import { createAaveGovernanceV3Plugin } from './plugin';
import { AAVE_GOVERNANCE_V3_TOPICS } from '../abi/events';
import { AaveGovernanceArchiveWriter } from '../ingestion/archive-writer';
import * as ingesterListener from '../ingestion/ingester-listener';

const CTX: SourceContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  sourceType: 'aave_governance_v3',
  chainId: '0x1',
  sourceLabel: 'aave_governance_v3',
};

const mockArchiveWriter = {
  writeCore: vi.fn().mockResolvedValue(undefined),
} as unknown as AaveGovernanceArchiveWriter;
const mockDlqRepo = { insert: vi.fn() } as unknown as DlqRepository;

function makePlugin() {
  return createAaveGovernanceV3Plugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

describe('createAaveGovernanceV3Plugin', () => {
  it('uses sourceType aave_governance_v3 and supported mainnet chain only', () => {
    const plugin = makePlugin();
    expect(plugin.sourceType).toBe('aave_governance_v3');
    expect(plugin.supportedChainIds).toEqual(['0x1']);
  });

  it('accepts governance_address and rejects governor_address', () => {
    const plugin = makePlugin();
    expect(
      plugin.parseConfig({
        governance_address: '0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7',
      }),
    ).toEqual({
      governance_address: '0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7',
    });
    expect(() =>
      plugin.parseConfig({
        governor_address: '0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7',
      }),
    ).toThrow();
  });

  it('buildIngestSpec lowercases the address and registers all 7 topics', () => {
    const plugin = makePlugin();
    const spec = plugin.buildIngestSpec(CTX, {
      governance_address: '0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7',
    });

    expect(spec.kind).toBe('evm-event-poller');
    expect(spec.filter.address).toBe('0x9aee0b04504cef83a65ac3f0e838d0593bcb2bc7');
    expect(spec.filter.topics).toEqual([
      [
        AAVE_GOVERNANCE_V3_TOPICS.ProposalCreated,
        AAVE_GOVERNANCE_V3_TOPICS.VotingActivated,
        AAVE_GOVERNANCE_V3_TOPICS.ProposalQueued,
        AAVE_GOVERNANCE_V3_TOPICS.ProposalExecuted,
        AAVE_GOVERNANCE_V3_TOPICS.ProposalCanceled,
        AAVE_GOVERNANCE_V3_TOPICS.ProposalFailed,
        AAVE_GOVERNANCE_V3_TOPICS.PayloadSent,
      ],
    ]);
  });

  it('buildBackfillRuntime uses the ingester listener with onWriteFailure=throw', () => {
    const spy = vi.spyOn(ingesterListener, 'makeAaveGovernanceIngesterListener');
    const plugin = makePlugin();
    const runtime = plugin.buildBackfillRuntime(CTX, {
      governance_address: '0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7',
    });

    runtime.listenerFactory();
    expect(spy).toHaveBeenCalledWith(expect.any(Object), { onWriteFailure: 'throw' });
  });

  it('buildArchiveConsumer decodes RawLogJob and calls writeCore', async () => {
    const plugin = makePlugin();
    const consume = plugin.buildArchiveConsumer!();

    await consume(CTX, {
      chainId: '0x1',
      blockNumber: '104',
      blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      logIndex: 1,
      address: '0x9aee0b04504cef83a65ac3f0e838d0593bcb2bc7',
      topics: [
        '0x712ae1383f79ac853f8d882153778e0260ef8f03b504e2866e0593e04d2b291f',
        '0x0000000000000000000000000000000000000000000000000000000000000068',
      ],
      data: '0x',
    });

    expect((mockArchiveWriter.writeCore as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual({
      type: 'ProposalExecuted',
      payload: { proposalId: '104' },
    });
  });
});
