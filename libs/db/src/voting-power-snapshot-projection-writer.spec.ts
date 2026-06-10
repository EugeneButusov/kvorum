import { describe, expect, it, vi } from 'vitest';
import { VotingPowerSnapshotProjectionWriter } from './voting-power-snapshot-projection-writer';

function makeInsertChain() {
  const chain = {
    values: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  chain.values.mockReturnValue(chain);
  return chain;
}

describe('VotingPowerSnapshotProjectionWriter', () => {
  it('returns 0 and does not write for empty input', async () => {
    const ch = { insertInto: vi.fn() };
    const writer = new VotingPowerSnapshotProjectionWriter(ch as never);

    await expect(writer.bulkInsert([])).resolves.toBe(0);
    expect(ch.insertInto).not.toHaveBeenCalled();
  });

  it('writes rows in chunks and returns inserted count', async () => {
    const insertChain = makeInsertChain();
    const ch = { insertInto: vi.fn().mockReturnValue(insertChain) };
    const writer = new VotingPowerSnapshotProjectionWriter(ch as never);
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      dao_id: 'dao-1',
      proposal_id: 'p-1',
      actor_address: `0x${i.toString(16)}`,
      voter_address: `0x${i.toString(16)}`,
      voting_power: String(i),
      actor_id_hint: null,
      computed_at: new Date('2026-01-01T00:00:00.000Z'),
    }));

    await expect(writer.bulkInsert(rows)).resolves.toBe(1001);
    expect(ch.insertInto).toHaveBeenCalledTimes(2);
    expect(ch.insertInto).toHaveBeenCalledWith('voting_power_snapshot_raw');
    expect(insertChain.values).toHaveBeenCalledTimes(2);
    expect((insertChain.values.mock.calls[0]![0] as unknown[]).length).toBe(1000);
    expect((insertChain.values.mock.calls[1]![0] as unknown[]).length).toBe(1);
  });
});
