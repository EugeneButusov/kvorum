import { describe, expect, it, vi } from 'vitest';
import { createDelegateRegistryPlugin, DelegateRegistryConfigSchema } from './plugin';
import { encodeSpaceId } from '../../delegation/address';
import { DELEGATE_REGISTRY_ADDRESS } from '../../delegation/constants';
import { DELEGATE_REGISTRY_INTERFACE } from '../abi/events';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function makePlugin() {
  const archiveWriter = { writeCore: vi.fn().mockResolvedValue(undefined) };
  const plugin = createDelegateRegistryPlugin({
    archiveWriter: archiveWriter as never,
    dlqRepo: {} as never,
    logger: logger as never,
  });
  return { plugin, archiveWriter };
}

describe('createDelegateRegistryPlugin', () => {
  it('validates the canonical registry address', () => {
    expect(
      DelegateRegistryConfigSchema.parse({ registry_address: DELEGATE_REGISTRY_ADDRESS }),
    ).toEqual({ registry_address: DELEGATE_REGISTRY_ADDRESS });
    expect(() =>
      DelegateRegistryConfigSchema.parse({ registry_address: `0x${'00'.repeat(20)}` }),
    ).toThrow();
  });

  it('builds an evm-event-poller spec topic-scoped to the seeded spaces + global', () => {
    const { plugin } = makePlugin();
    const spec = plugin.buildIngestSpec({} as never, {
      registry_address: DELEGATE_REGISTRY_ADDRESS,
    });
    expect(spec.kind).toBe('evm-event-poller');
    if (spec.kind !== 'evm-event-poller') throw new Error('unreachable');
    expect(spec.filter.address).toBe(DELEGATE_REGISTRY_ADDRESS);
    const idTopics = spec.filter.topics[2] as string[];
    expect(idTopics).toContain(encodeSpaceId('lido-snapshot.eth'));
    expect(idTopics).toContain(`0x${'00'.repeat(32)}`);
  });

  it('exposes a backfill runtime with the same filter', () => {
    const { plugin } = makePlugin();
    const runtime = plugin.buildBackfillRuntime!(
      { sourceType: 'snapshot_delegate_registry' } as never,
      {
        registry_address: DELEGATE_REGISTRY_ADDRESS,
      },
    );
    expect(runtime.filter.address).toBe(DELEGATE_REGISTRY_ADDRESS);
    expect(typeof runtime.listenerFactory()).toBe('function');
  });

  it('archive consumer decodes and writes a SetDelegate', async () => {
    const { plugin, archiveWriter } = makePlugin();
    const fragment = DELEGATE_REGISTRY_INTERFACE.getEvent('SetDelegate')!;
    const { data, topics } = DELEGATE_REGISTRY_INTERFACE.encodeEventLog(fragment, [
      `0x${'11'.repeat(20)}`,
      encodeSpaceId('lido-snapshot.eth'),
      `0x${'22'.repeat(20)}`,
    ]);
    const consume = plugin.buildArchiveConsumer!();
    await consume(
      {
        sourceType: 'snapshot_delegate_registry',
        chainId: '0x1',
        daoSourceId: 's',
        sourceLabel: 's',
      },
      {
        chainId: '0x1',
        blockNumber: '1',
        blockHash: '0xbb',
        txHash: '0xcc',
        logIndex: 0,
        address: DELEGATE_REGISTRY_ADDRESS,
        topics,
        data,
      },
    );
    expect(archiveWriter.writeCore).toHaveBeenCalledOnce();
  });
});
