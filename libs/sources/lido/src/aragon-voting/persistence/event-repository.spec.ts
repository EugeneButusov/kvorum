import { describe, expect, it, vi } from 'vitest';
import { AragonVotingEventRepository } from './event-repository';
import type { AragonVotingEventData } from './event-repository.types';

const EVENT_DATA: AragonVotingEventData = {
  daoSourceId: '00000000-0000-0000-0000-000000000001',
  chainId: '0x1',
  blockNumber: '11500000',
  blockHash: '0x' + 'ab'.repeat(32),
  txHash: '0x' + 'cd'.repeat(32),
  logIndex: 0,
  eventType: 'StartVote',
  payload:
    '{"voteId":"1","creator":"0x1111111111111111111111111111111111111111","metadata":"AIP-1"}',
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

describe('AragonVotingEventRepository', () => {
  it('maps EventData fields to snake_case columns', async () => {
    const chain = makeInsertChain();
    const repo = new AragonVotingEventRepository({
      chDb: { insertInto: chain.insertInto } as never,
    });
    await repo.insert(EVENT_DATA);

    expect(chain.insertInto).toHaveBeenCalledWith('archive_event_aragon_voting');
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
    const repo = new AragonVotingEventRepository({
      chDb: { insertInto: chain.insertInto } as never,
    });
    await repo.insert(EVENT_DATA);

    expect((chain.capturedValues as Record<string, unknown>)['received_at']).toBeUndefined();
  });

  it('propagates insert errors', async () => {
    const chain = makeInsertChain({ throws: new Error('connection refused') });
    const repo = new AragonVotingEventRepository({
      chDb: { insertInto: chain.insertInto } as never,
    });

    await expect(repo.insert(EVENT_DATA)).rejects.toThrow('connection refused');
  });
});
