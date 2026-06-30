import { describe, it, expect, vi } from 'vitest';
import { SnapshotProposalRepository } from './snapshot-proposal-repository';

describe('SnapshotProposalRepository', () => {
  it('upsertMetadata inserts with an on-conflict DO UPDATE', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const doUpdateSet = vi.fn(() => ({}));
    const onConflict = vi.fn((cb: (oc: unknown) => unknown) => {
      cb({ column: () => ({ doUpdateSet }) });
      return { execute };
    });
    const values = vi.fn(() => ({ onConflict }));
    const insertInto = vi.fn(() => ({ values }));
    const repo = new SnapshotProposalRepository({ insertInto } as never);

    await repo.upsertMetadata({
      proposal_id: 'p1',
      space_id: 'lido-snapshot.eth',
      voting_type: 'single-choice',
      strategies: null,
      ipfs_hash: null,
      network: '1',
      scores_state: 'final',
      flagged: false,
    });

    expect(insertInto).toHaveBeenCalledWith('snapshot_proposal_metadata');
    expect(doUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ space_id: 'lido-snapshot.eth', scores_state: 'final' }),
    );
    expect(execute).toHaveBeenCalled();
  });

  it('upsertMetadata defaults nullable fields on conflict', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const doUpdateSet = vi.fn(() => ({}));
    const onConflict = vi.fn((cb: (oc: unknown) => unknown) => {
      cb({ column: () => ({ doUpdateSet }) });
      return { execute };
    });
    const insertInto = vi.fn(() => ({ values: () => ({ onConflict }) }));
    const repo = new SnapshotProposalRepository({ insertInto } as never);

    await repo.upsertMetadata({ proposal_id: 'p1', space_id: 's' });

    expect(doUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ voting_type: null, scores_state: null, flagged: false }),
    );
  });

  it('findStaleClosedProposalIds builds the bounded query and returns source ids', async () => {
    const builder: Record<string, unknown> = {};
    for (const method of ['innerJoin', 'select', 'orderBy', 'limit']) {
      builder[method] = vi.fn(() => builder);
    }
    builder['where'] = vi.fn((arg: unknown) => {
      if (typeof arg === 'function') {
        const eb = (() => ({})) as unknown as {
          (..._a: unknown[]): unknown;
          or: (a: unknown) => unknown;
        };
        eb.or = () => ({});
        (arg as (e: unknown) => unknown)(eb);
      }
      return builder;
    });
    builder['execute'] = vi.fn().mockResolvedValue([{ source_id: '0xa' }, { source_id: '0xb' }]);
    const selectFrom = vi.fn(() => builder);
    const repo = new SnapshotProposalRepository({ selectFrom } as never);

    const ids = await repo.findStaleClosedProposalIds('lido-snapshot.eth', 25);

    expect(selectFrom).toHaveBeenCalledWith('proposal as p');
    expect(builder['limit']).toHaveBeenCalledWith(25);
    expect(ids).toEqual(['0xa', '0xb']);
  });
});
