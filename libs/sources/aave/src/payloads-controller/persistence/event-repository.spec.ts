import { describe, expect, it, vi } from 'vitest';
import { AavePayloadsControllerEventRepository } from './event-repository';
import type { AavePayloadsControllerEventData } from './event-repository.types';

const EVENT_DATA: AavePayloadsControllerEventData = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  chainId: '0xa',
  blockNumber: '138147943',
  blockHash: '0x4115905ab3ebffac8b2aa91813b49420d0083b9fb56eced2426d3d6aa3d74dc9',
  txHash: '0xa245760924ffc169314b6a47859bd9c64a32252c6aa4e664cccbf719fb500253',
  logIndex: 640,
  eventType: 'PayloadCreated',
  payload: '{"payloadId":"80"}',
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

describe('AavePayloadsControllerEventRepository', () => {
  it('maps EventData fields to snake_case columns', async () => {
    const chain = makeInsertChain();
    const repo = new AavePayloadsControllerEventRepository({
      chDb: { insertInto: chain.insertInto },
    } as never);
    await repo.insert(EVENT_DATA);

    expect(chain.insertInto).toHaveBeenCalledWith('archive_event_aave_payloads_controller');
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
    const repo = new AavePayloadsControllerEventRepository({
      chDb: { insertInto: chain.insertInto },
    } as never);
    await repo.insert(EVENT_DATA);

    expect((chain.capturedValues as Record<string, unknown>)['received_at']).toBeUndefined();
  });

  it('propagates insert errors', async () => {
    const chain = makeInsertChain({ throws: new Error('connection refused') });
    const repo = new AavePayloadsControllerEventRepository({
      chDb: { insertInto: chain.insertInto },
    } as never);

    await expect(repo.insert(EVENT_DATA)).rejects.toThrow('connection refused');
  });
});
