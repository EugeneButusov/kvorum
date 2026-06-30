import { describe, it, expect, vi } from 'vitest';
import { SnapshotVoteChoiceRepository } from './snapshot-vote-choice-repository';

function mockCh(rows: Array<Record<string, unknown>>) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'where', 'limit']) builder[m] = vi.fn(() => builder);
  builder['execute'] = vi.fn().mockResolvedValue(rows);
  const insertExecute = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ execute: insertExecute }));
  const insertInto = vi.fn(() => ({ values }));
  const selectFrom = vi.fn(() => builder);
  return { db: { selectFrom, insertInto } as never, values, insertInto, insertExecute };
}

describe('SnapshotVoteChoiceRepository', () => {
  it('insert serializes choices + vp_by_strategy as JSON', async () => {
    const { db, insertInto, values, insertExecute } = mockCh([]);
    const repo = new SnapshotVoteChoiceRepository(db);

    await repo.insert({
      voteId: 'r1',
      choices: [{ choice_index: 0, weight: '1.0' }],
      vp: '100',
      vpByStrategy: [100],
    });

    expect(insertInto).toHaveBeenCalledWith('snapshot_vote_choice');
    expect(values).toHaveBeenCalledWith({
      vote_id: 'r1',
      choices: '[{"choice_index":0,"weight":"1.0"}]',
      vp: '100',
      vp_by_strategy: '[100]',
    });
    expect(insertExecute).toHaveBeenCalled();
  });

  it('findByVoteId returns the greatest-version parsed breakdown', async () => {
    const { db } = mockCh([
      { choices: '[{"choice_index":1,"weight":"1.0"}]', version: '1' },
      { choices: '[{"choice_index":0,"weight":"1.0"}]', version: '2' },
    ]);
    const repo = new SnapshotVoteChoiceRepository(db);
    expect(await repo.findByVoteId('r1')).toEqual([{ choice_index: 0, weight: '1.0' }]);
  });

  it('findByVoteId returns undefined when absent', async () => {
    const { db } = mockCh([]);
    const repo = new SnapshotVoteChoiceRepository(db);
    expect(await repo.findByVoteId('r1')).toBeUndefined();
  });

  it('existsForVote reflects presence', async () => {
    const present = new SnapshotVoteChoiceRepository(mockCh([{ vote_id: 'r1' }]).db);
    expect(await present.existsForVote('r1')).toBe(true);
    const absent = new SnapshotVoteChoiceRepository(mockCh([]).db);
    expect(await absent.existsForVote('r1')).toBe(false);
  });
});
