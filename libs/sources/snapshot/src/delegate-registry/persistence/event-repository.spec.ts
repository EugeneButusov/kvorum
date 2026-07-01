import { describe, expect, it, vi } from 'vitest';
import { DelegateRegistryEventRepository } from './event-repository';
import type { DelegateRegistryEventData } from './event-repository.types';

const DATA: DelegateRegistryEventData = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  chainId: '0x1',
  blockNumber: '11225330',
  blockHash: `0x${'bb'.repeat(32)}`,
  txHash: `0x${'cc'.repeat(32)}`,
  logIndex: 2,
  eventType: 'SetDelegate',
  payload: '{"delegator":"0x11","id":"0x00","delegate":"0x22"}',
};

function makeChain() {
  let captured: unknown;
  const execute = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockImplementation((v: unknown) => {
    captured = v;
    return { execute };
  });
  return {
    insertInto: vi.fn().mockReturnValue({ values }),
    get captured() {
      return captured;
    },
  };
}

describe('DelegateRegistryEventRepository', () => {
  it('maps fields to archive_event_snapshot_delegate_registry, omitting received_at', async () => {
    const chain = makeChain();
    const repo = new DelegateRegistryEventRepository({
      chDb: { insertInto: chain.insertInto },
    } as never);
    await repo.insert(DATA);
    expect(chain.insertInto).toHaveBeenCalledWith('archive_event_snapshot_delegate_registry');
    const vals = chain.captured as Record<string, unknown>;
    expect(vals['dao_source_id']).toBe(DATA.daoSourceId);
    expect(vals['event_type']).toBe('SetDelegate');
    expect(vals['received_at']).toBeUndefined();
  });
});
