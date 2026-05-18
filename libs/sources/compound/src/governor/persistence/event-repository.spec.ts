import { describe, it, expect, vi } from 'vitest';
import { EventRepository } from './event-repository';
import type { EventData } from './event-repository.types';

const EVENT_DATA: EventData = {
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

describe('EventRepository', () => {
  it('#1 — maps EventData fields to snake_case columns', async () => {
    const chain = makeInsertChain();
    const repo = new EventRepository({ chDb: { insertInto: chain.insertInto } } as never);
    await repo.insert(EVENT_DATA);

    expect(chain.insertInto).toHaveBeenCalledWith('event_archive_compound_governor_bravo');
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

  it('#2 — does not include received_at in inserted values', async () => {
    const chain = makeInsertChain();
    const repo = new EventRepository({ chDb: { insertInto: chain.insertInto } } as never);
    await repo.insert(EVENT_DATA);

    expect((chain.capturedValues as Record<string, unknown>)['received_at']).toBeUndefined();
  });

  it('#3 — propagates insert errors', async () => {
    const chain = makeInsertChain({ throws: new Error('connection refused') });
    const repo = new EventRepository({ chDb: { insertInto: chain.insertInto } } as never);

    await expect(repo.insert(EVENT_DATA)).rejects.toThrow('connection refused');
  });
});
