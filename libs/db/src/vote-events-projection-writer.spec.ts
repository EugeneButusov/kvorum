import { describe, expect, it, vi } from 'vitest';
import { VoteEventsProjectionWriter } from './vote-events-projection-writer';

function makeInsertChain() {
  const chain = {
    values: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  chain.values.mockReturnValue(chain);
  return chain;
}

describe('VoteEventsProjectionWriter', () => {
  it('does nothing for empty batch', async () => {
    const ch = { insertInto: vi.fn() };
    const writer = new VoteEventsProjectionWriter(ch as never);

    await expect(writer.insertBatch([])).resolves.toBeUndefined();
    expect(ch.insertInto).not.toHaveBeenCalled();
  });

  it('inserts all rows for non-empty batch', async () => {
    const insertChain = makeInsertChain();
    const ch = { insertInto: vi.fn().mockReturnValue(insertChain) };
    const writer = new VoteEventsProjectionWriter(ch as never);
    const rows = [
      {
        vote_id: 'v1',
        dao_id: 'dao-1',
        proposal_id: 'p-1',
        voter_address: '0xabc',
        voting_chain_id: '0x1',
        primary_choice: 1,
        voting_power: '10',
        cast_at: new Date('2026-01-01T00:00:00.000Z'),
        block_number: '100',
        log_index: 0,
        superseded: 0,
        superseded_at: null,
        superseded_by_vote_id: null,
      },
    ] as const;

    await expect(writer.insertBatch(rows)).resolves.toBeUndefined();
    expect(ch.insertInto).toHaveBeenCalledWith('vote_events_raw');
    expect(insertChain.values).toHaveBeenCalledWith([...rows]);
    expect(insertChain.execute).toHaveBeenCalledTimes(1);
  });
});
