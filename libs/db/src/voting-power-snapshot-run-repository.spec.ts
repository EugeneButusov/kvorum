import { describe, expect, it, vi } from 'vitest';
import { VotingPowerSnapshotRunRepository } from './voting-power-snapshot-run-repository';

function makeUpdateChain(returnValue: unknown = undefined) {
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    executeTakeFirst,
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return { updateTable: vi.fn().mockReturnValue(chain), chain };
}

describe('VotingPowerSnapshotRunRepository', () => {
  it('resets retry state for proposal run', async () => {
    const update = makeUpdateChain();
    const repo = new VotingPowerSnapshotRunRepository({ updateTable: update.updateTable } as never);

    await repo.resetAttemptForRetry('proposal-1');

    expect(update.updateTable).toHaveBeenCalledWith('voting_power_snapshot_run');
    expect(update.chain.set).toHaveBeenCalledWith({
      snapshot_attempt_count: 0,
      status: 'in_progress',
      last_error: null,
    });
    expect(update.chain.where).toHaveBeenCalledWith('proposal_id', '=', 'proposal-1');
    expect(update.chain.executeTakeFirst).toHaveBeenCalledTimes(1);
  });
});
