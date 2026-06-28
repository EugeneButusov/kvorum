import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { DlqRepository } from '@libs/db';
import type { SourceContext } from '@sources/core';
import { createLidoEasyTrackPlugin } from './plugin';
import { EASY_TRACK_TOPICS, EASY_TRACK_INTERFACE } from '../abi/events';
import { LidoEasyTrackArchiveWriter } from '../ingestion/archive-writer';
import * as ingesterListener from '../ingestion/ingester-listener';

const CTX: SourceContext = {
  daoSourceId: '00000000-0000-0000-0000-000000000003',
  sourceType: 'easy_track',
  chainId: '0x1',
  sourceLabel: 'easy_track',
};

const EASY_TRACK_ADDRESS = '0xF0211b7660680B49De1A7E9f25C65660F0a13Fea';
const EXECUTOR_ADDRESS = '0xFE5986E06210aC1eCC1aDCafc0cc7f8D63B3F977';
const CONFIG = { easy_track_address: EASY_TRACK_ADDRESS };

const mockArchiveWriter = {
  writeCore: vi.fn().mockResolvedValue(undefined),
} as unknown as LidoEasyTrackArchiveWriter;

const mockDlqRepo = { insert: vi.fn() } as unknown as DlqRepository;

function makePlugin() {
  return createLidoEasyTrackPlugin({
    archiveWriter: mockArchiveWriter,
    dlqRepo: mockDlqRepo,
    logger: silentLogger,
  });
}

describe('createLidoEasyTrackPlugin', () => {
  it('uses sourceType easy_track and supports only mainnet', () => {
    const plugin = makePlugin();
    expect(plugin.sourceType).toBe('easy_track');
    expect(plugin.supportedChainIds).toEqual(['0x1']);
    expect(plugin.buildBackfillRuntime).toBeDefined(); // backfillable
  });

  it('parseConfig requires the easy_track address, allows the optional executor, rejects junk', () => {
    const plugin = makePlugin();
    expect(plugin.parseConfig(CONFIG)).toEqual(CONFIG);
    expect(
      plugin.parseConfig({
        easy_track_address: EASY_TRACK_ADDRESS,
        evm_script_executor_address: EXECUTOR_ADDRESS,
      }),
    ).toEqual({
      easy_track_address: EASY_TRACK_ADDRESS,
      evm_script_executor_address: EXECUTOR_ADDRESS,
    });
    expect(() => plugin.parseConfig({})).toThrow();
    expect(() => plugin.parseConfig({ easy_track_address: 'nope' })).toThrow();
  });

  it('buildIngestSpec watches the easy_track address (lowercased) with all motion topics', () => {
    const plugin = makePlugin();
    const spec = plugin.buildIngestSpec(CTX, CONFIG);
    expect(spec.kind).toBe('evm-event-poller');
    expect(spec.filter.address).toEqual([EASY_TRACK_ADDRESS.toLowerCase()]);
    const topics = spec.filter.topics?.[0] as string[];
    expect(topics).toEqual(
      expect.arrayContaining([
        EASY_TRACK_TOPICS.MotionCreated,
        EASY_TRACK_TOPICS.MotionEnacted,
        EASY_TRACK_TOPICS.MotionObjected,
        EASY_TRACK_TOPICS.MotionRejected,
        EASY_TRACK_TOPICS.MotionCanceled,
      ]),
    );
    expect(topics).toHaveLength(9);
  });

  it('buildBackfillRuntime uses the ingester listener with onWriteFailure=throw', () => {
    const spy = vi.spyOn(ingesterListener, 'makeEasyTrackIngesterListener');
    const plugin = makePlugin();
    const runtime = plugin.buildBackfillRuntime!(CTX, CONFIG);
    runtime.listenerFactory();
    expect(spy).toHaveBeenCalledWith(expect.any(Object), { onWriteFailure: 'throw' });
  });

  it('buildArchiveConsumer decodes a RawLogJob and calls writeCore', async () => {
    const plugin = makePlugin();
    const consume = plugin.buildArchiveConsumer!();
    const fragment = EASY_TRACK_INTERFACE.getEvent('MotionEnacted')!;
    const encoded = EASY_TRACK_INTERFACE.encodeEventLog(fragment, [7n]);

    await consume(CTX, {
      chainId: '0x1',
      blockNumber: '13680000',
      blockHash: '0x' + 'ab'.repeat(32),
      txHash: '0x' + 'cd'.repeat(32),
      logIndex: 1,
      address: EASY_TRACK_ADDRESS.toLowerCase(),
      topics: encoded.topics as string[],
      data: encoded.data,
    });

    const writeCoreMock = mockArchiveWriter.writeCore as ReturnType<typeof vi.fn>;
    expect(writeCoreMock.mock.calls[0]?.[1]).toEqual({
      type: 'MotionEnacted',
      payload: { motionId: '7' },
    });
  });
});
