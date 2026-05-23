import { describe, expect, it, vi } from 'vitest';
import { VoteRepository } from './vote-repository';

interface ConflictBuilder {
  columns(columns: string[]): {
    where(
      column: string,
      operator: string,
      value: null,
    ): {
      doNothing(): {
        returning(column: string): { executeTakeFirst(): Promise<{ id: string } | undefined> };
      };
    };
  };
}

describe('VoteRepository', () => {
  it('inserts vote with partial-index conflict target', async () => {
    let whereArgs: [string, string, null] | undefined;
    const executeTakeFirst = vi.fn().mockResolvedValue({ id: 'vote-1' });
    const onConflict = vi.fn().mockImplementation((fn: (oc: ConflictBuilder) => unknown) => {
      fn({
        columns: (_cols: string[]) => ({
          where: (column: string, operator: string, value: null) => {
            whereArgs = [column, operator, value];
            return { doNothing: () => ({ returning: () => ({ executeTakeFirst }) }) };
          },
        }),
      });
      return { returning: () => ({ executeTakeFirst }) };
    });
    const values = vi.fn().mockReturnValue({ onConflict });
    const insertInto = vi.fn().mockReturnValue({ values });

    const repo = new VoteRepository({ insertInto } as never);
    await expect(
      repo.insertVote({
        proposal_id: 'proposal-1',
        voter_actor_id: 'actor-1',
        voting_power_reported: '10',
        cast_at: new Date('2026-01-01T00:00:00Z'),
        block_number: '100',
        tx_index: 0,
        tx_hash: '0xtx',
        log_index: 1,
        primary_choice: 1,
        reason: 'reason',
      }),
    ).resolves.toEqual({ inserted: true, voteId: 'vote-1' });

    expect(insertInto).toHaveBeenCalledWith('vote');
    expect(whereArgs).toEqual(['tx_hash', 'is not', null]);
  });

  it('returns idempotent result when vote insert conflicts', async () => {
    const executeTakeFirst = vi.fn().mockResolvedValue(undefined);
    const onConflict = vi.fn().mockImplementation((fn: (oc: ConflictBuilder) => unknown) => {
      fn({
        columns: () => ({
          where: () => ({
            doNothing: () => ({ returning: () => ({ executeTakeFirst }) }),
          }),
        }),
      });
      return { returning: () => ({ executeTakeFirst }) };
    });
    const values = vi.fn().mockReturnValue({ onConflict });
    const insertInto = vi.fn().mockReturnValue({ values });
    const repo = new VoteRepository({ insertInto } as never);

    await expect(
      repo.insertVote({
        proposal_id: 'proposal-1',
        voter_actor_id: 'actor-1',
        voting_power_reported: '10',
        cast_at: new Date('2026-01-01T00:00:00Z'),
        block_number: '100',
        tx_index: 0,
        tx_hash: '0xtx',
        log_index: 1,
        primary_choice: 1,
        reason: null,
      }),
    ).resolves.toEqual({ inserted: false });
  });
});
