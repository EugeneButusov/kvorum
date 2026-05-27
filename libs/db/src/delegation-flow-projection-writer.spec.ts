import { describe, expect, it, vi } from 'vitest';
import { DelegationFlowProjectionWriter } from './delegation-flow-projection-writer';

function makeInsertChain() {
  const chain = {
    values: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  chain.values.mockReturnValue(chain);
  return chain;
}

describe('DelegationFlowProjectionWriter', () => {
  it('does nothing for empty batch', async () => {
    const ch = { insertInto: vi.fn() };
    const writer = new DelegationFlowProjectionWriter(ch as never);

    await expect(writer.insertBatch([])).resolves.toBeUndefined();
    expect(ch.insertInto).not.toHaveBeenCalled();
  });

  it('inserts delegation rows into projection table', async () => {
    const insertChain = makeInsertChain();
    const ch = { insertInto: vi.fn().mockReturnValue(insertChain) };
    const writer = new DelegationFlowProjectionWriter(ch as never);
    const rows = [
      {
        delegation_id: 'd1',
        dao_id: 'dao-1',
        delegator_address: '0x1',
        delegate_address: '0x2',
        voting_power: '0',
        block_number: '100',
        log_index: 1,
        event_type: 'delegate_changed',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ] as const;

    await expect(writer.insertBatch(rows)).resolves.toBeUndefined();
    expect(ch.insertInto).toHaveBeenCalledWith('delegation_flow_projection');
    expect(insertChain.values).toHaveBeenCalledWith([...rows]);
    expect(insertChain.execute).toHaveBeenCalledTimes(1);
  });
});
