import { describe, expect, it, vi } from 'vitest';
import { createSplitDelegationPlugin, SplitDelegationConfigSchema } from './plugin';
import { SPLIT_DELEGATION_ADDRESS } from '../../delegation/constants';
import { SPLIT_DELEGATION_INTERFACE } from '../abi/events';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function makePlugin() {
  const archiveWriter = { writeCore: vi.fn().mockResolvedValue(undefined) };
  const plugin = createSplitDelegationPlugin({
    archiveWriter: archiveWriter as never,
    dlqRepo: {} as never,
    logger: logger as never,
  });
  return { plugin, archiveWriter };
}

function clearedLog(context: string) {
  const fragment = SPLIT_DELEGATION_INTERFACE.getEvent('DelegationCleared')!;
  const { data, topics } = SPLIT_DELEGATION_INTERFACE.encodeEventLog(fragment, [
    `0x${'11'.repeat(20)}`,
    context,
    [],
  ]);
  return {
    chainId: '0x1',
    blockNumber: '1',
    blockHash: '0xbb',
    txHash: '0xcc',
    logIndex: 0,
    address: SPLIT_DELEGATION_ADDRESS,
    topics,
    data,
  };
}

describe('createSplitDelegationPlugin', () => {
  it('validates the canonical registry address', () => {
    expect(
      SplitDelegationConfigSchema.parse({ registry_address: SPLIT_DELEGATION_ADDRESS }),
    ).toEqual({
      registry_address: SPLIT_DELEGATION_ADDRESS,
    });
    expect(() =>
      SplitDelegationConfigSchema.parse({ registry_address: `0x${'00'.repeat(20)}` }),
    ).toThrow();
  });

  it('builds an evm-event-poller spec filtered only by event signature (context is un-indexed)', () => {
    const { plugin } = makePlugin();
    const spec = plugin.buildIngestSpec({} as never, {
      registry_address: SPLIT_DELEGATION_ADDRESS,
    });
    if (spec.kind !== 'evm-event-poller') throw new Error('unreachable');
    expect(spec.filter.topics).toHaveLength(1);
  });

  it('archive consumer writes for a tracked context', async () => {
    const { plugin, archiveWriter } = makePlugin();
    const consume = plugin.buildArchiveConsumer!();
    await consume(
      {
        sourceType: 'snapshot_split_delegation',
        chainId: '0x1',
        daoSourceId: 's',
        sourceLabel: 's',
      },
      clearedLog('lido-snapshot.eth'),
    );
    expect(archiveWriter.writeCore).toHaveBeenCalledOnce();
  });

  it('archive consumer drops an out-of-scope context before writing', async () => {
    const { plugin, archiveWriter } = makePlugin();
    const consume = plugin.buildArchiveConsumer!();
    await consume(
      {
        sourceType: 'snapshot_split_delegation',
        chainId: '0x1',
        daoSourceId: 's',
        sourceLabel: 's',
      },
      clearedLog('someother.eth'),
    );
    expect(archiveWriter.writeCore).not.toHaveBeenCalled();
  });

  it('backfill runtime carries the filter predicate', () => {
    const { plugin } = makePlugin();
    const runtime = plugin.buildBackfillRuntime!(
      { sourceType: 'snapshot_split_delegation' } as never,
      {
        registry_address: SPLIT_DELEGATION_ADDRESS,
      },
    );
    expect(typeof runtime.listenerFactory()).toBe('function');
  });
});
