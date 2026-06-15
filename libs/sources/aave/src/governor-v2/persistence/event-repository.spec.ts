import { describe, expect, it, vi } from 'vitest';
import { AaveGovernorV2EventRepository } from './event-repository';
import type { AaveGovernorV2EventData } from './event-repository.types';

const EVENT_DATA: AaveGovernorV2EventData = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  chainId: '0x1',
  blockNumber: '12010000',
  blockHash: '0x' + 'ab'.repeat(32),
  txHash: '0x' + 'cd'.repeat(32),
  logIndex: 3,
  eventType: 'ProposalCreated',
  payload: '{"id":"7"}',
};

function makeInsertChain(opts: { throws?: unknown } = {}) {
  let capturedValues: unknown;
  const execute = opts.throws
    ? vi.fn().mockRejectedValue(opts.throws)
    : vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockImplementation((v: unknown) => {
    capturedValues = v;
    return { execute };
  });
  const insertInto = vi.fn().mockReturnValue({ values });
  return {
    insertInto,
    get capturedValues() {
      return capturedValues;
    },
  };
}

describe('AaveGovernorV2EventRepository', () => {
  it('maps EventData fields to snake_case columns', async () => {
    const chain = makeInsertChain();
    const repo = new AaveGovernorV2EventRepository({
      chDb: { insertInto: chain.insertInto } as never,
    });
    await repo.insert(EVENT_DATA);

    expect(chain.insertInto).toHaveBeenCalledWith('archive_event_aave_governor_v2');
    const vals = chain.capturedValues as Record<string, unknown>;
    expect(vals['dao_source_id']).toBe(EVENT_DATA.daoSourceId);
    expect(vals['chain_id']).toBe(EVENT_DATA.chainId);
    expect(vals['block_number']).toBe(EVENT_DATA.blockNumber);
    expect(vals['block_hash']).toBe(EVENT_DATA.blockHash);
    expect(vals['tx_hash']).toBe(EVENT_DATA.txHash);
    expect(vals['log_index']).toBe(EVENT_DATA.logIndex);
    expect(vals['event_type']).toBe(EVENT_DATA.eventType);
    expect(vals['payload']).toBe(EVENT_DATA.payload);
  });

  it('does not include received_at in inserted values', async () => {
    const chain = makeInsertChain();
    const repo = new AaveGovernorV2EventRepository({
      chDb: { insertInto: chain.insertInto } as never,
    });
    await repo.insert(EVENT_DATA);

    expect((chain.capturedValues as Record<string, unknown>)['received_at']).toBeUndefined();
  });

  it('propagates insert errors', async () => {
    const chain = makeInsertChain({ throws: new Error('connection refused') });
    const repo = new AaveGovernorV2EventRepository({
      chDb: { insertInto: chain.insertInto } as never,
    });

    await expect(repo.insert(EVENT_DATA)).rejects.toThrow('connection refused');
  });
});
