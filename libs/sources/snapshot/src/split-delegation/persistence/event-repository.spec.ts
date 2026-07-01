import { describe, expect, it, vi } from 'vitest';
import { SplitDelegationEventRepository } from './event-repository';
import type { SplitDelegationEventData } from './event-repository.types';

const DATA: SplitDelegationEventData = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  chainId: '0x1',
  blockNumber: '19200001',
  blockHash: `0x${'bb'.repeat(32)}`,
  txHash: `0x${'cc'.repeat(32)}`,
  logIndex: 0,
  eventType: 'DelegationUpdated',
  payload: '{"account":"0x11","context":"lido-snapshot.eth","delegation":[]}',
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

describe('SplitDelegationEventRepository', () => {
  it('maps fields to archive_event_snapshot_split_delegation', async () => {
    const chain = makeChain();
    const repo = new SplitDelegationEventRepository({
      chDb: { insertInto: chain.insertInto },
    } as never);
    await repo.insert(DATA);
    expect(chain.insertInto).toHaveBeenCalledWith('archive_event_snapshot_split_delegation');
    const vals = chain.captured as Record<string, unknown>;
    expect(vals['event_type']).toBe('DelegationUpdated');
    expect(vals['log_index']).toBe(0);
  });
});
