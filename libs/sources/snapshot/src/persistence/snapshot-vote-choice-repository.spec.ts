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

  it('computeChoiceScores sums approval votes (full vp per approved choice)', async () => {
    const repo = new SnapshotVoteChoiceRepository(
      mockCh([
        { vote_id: 'v1', choices: c([0, 2]), vp: '100', version: '1' }, // approves 0 and 2
        { vote_id: 'v2', choices: c([0]), vp: '50', version: '1' }, // approves 0
      ]).db,
    );
    expect(await repo.computeChoiceScores('p1')).toEqual([150, 0, 100]);
  });

  it('computeChoiceScores sums weighted votes (fractional weight × vp)', async () => {
    const repo = new SnapshotVoteChoiceRepository(
      mockCh([
        {
          vote_id: 'v1',
          choices: '[{"choice_index":0,"weight":"0.5"},{"choice_index":1,"weight":"0.5"}]',
          vp: '100',
          version: '1',
        },
      ]).db,
    );
    expect(await repo.computeChoiceScores('p1')).toEqual([50, 50]);
  });

  it('computeChoiceScores keeps the max-version row per vote', async () => {
    const repo = new SnapshotVoteChoiceRepository(
      mockCh([
        { vote_id: 'v1', choices: c([0]), vp: '10', version: '2026-01-01 00:00:00' },
        { vote_id: 'v1', choices: c([1]), vp: '99', version: '2026-01-02 00:00:00' }, // newer wins
      ]).db,
    );
    expect(await repo.computeChoiceScores('p1')).toEqual([0, 99]);
  });

  it('computeChoiceScores returns null when the proposal has no votes', async () => {
    const repo = new SnapshotVoteChoiceRepository(mockCh([]).db);
    expect(await repo.computeChoiceScores('p1')).toBeNull();
  });
});

// Approval-style choices JSON (each selected choice weight 1.0), for the score-aggregation tests.
function c(indices: number[]): string {
  return JSON.stringify(indices.map((choice_index) => ({ choice_index, weight: '1.0' })));
}
