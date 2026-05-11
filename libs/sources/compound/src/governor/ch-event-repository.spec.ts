import { describe, it, expect, vi } from 'vitest';
import { ChEventRepository } from './ch-event-repository';
import type { ChEventData } from './ch-event-repository.types';

const CH_DATA: ChEventData = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  chainId: 1,
  blockNumber: '20000000',
  blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
  txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
  logIndex: 3,
  eventType: 'ProposalCreated',
  payload: '{"proposalId":"42"}',
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

describe('ChEventRepository', () => {
  it('#1 — maps ChEventData fields to snake_case columns', async () => {
    const chain = makeInsertChain();
    const repo = new ChEventRepository({ chDb: { insertInto: chain.insertInto } } as never);
    await repo.insert(CH_DATA);

    expect(chain.insertInto).toHaveBeenCalledWith('event_archive_compound_governor');
    const vals = chain.capturedValues as Record<string, unknown>;
    expect(vals['dao_source_id']).toBe(CH_DATA.daoSourceId);
    expect(vals['chain_id']).toBe(CH_DATA.chainId);
    expect(vals['block_number']).toBe(CH_DATA.blockNumber);
    expect(vals['block_hash']).toBe(CH_DATA.blockHash);
    expect(vals['tx_hash']).toBe(CH_DATA.txHash);
    expect(vals['log_index']).toBe(CH_DATA.logIndex);
    expect(vals['event_type']).toBe(CH_DATA.eventType);
    expect(vals['payload']).toBe(CH_DATA.payload);
  });

  it('#2 — does not include received_at in CH values', async () => {
    const chain = makeInsertChain();
    const repo = new ChEventRepository({ chDb: { insertInto: chain.insertInto } } as never);
    await repo.insert(CH_DATA);

    expect((chain.capturedValues as Record<string, unknown>)['received_at']).toBeUndefined();
  });

  it('#3 — propagates CH errors', async () => {
    const chErr = new Error('ClickHouse down');
    const chain = makeInsertChain({ throws: chErr });
    const repo = new ChEventRepository({ chDb: { insertInto: chain.insertInto } } as never);

    await expect(repo.insert(CH_DATA)).rejects.toThrow('ClickHouse down');
  });
});
