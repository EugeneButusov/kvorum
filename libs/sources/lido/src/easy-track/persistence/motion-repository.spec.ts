import { describe, expect, it, vi } from 'vitest';
import { EasyTrackMotionRepository } from './motion-repository';
import type { NewEasyTrackMotionMeta } from '../../persistence/schema';

const META: NewEasyTrackMotionMeta = {
  proposal_id: '00000000-0000-0000-0000-0000000000aa',
  motion_id: '42',
  factory_address: '0x2222222222222222222222222222222222222222',
  objection_ends_at: new Date('2026-01-04T00:00:00Z'),
  state: 'active',
  last_reconcile_check_block: null,
};

function makeInsertChain() {
  let captured: unknown;
  const execute = vi.fn().mockResolvedValue(undefined);
  const onConflict = vi.fn().mockReturnValue({ execute });
  const values = vi.fn().mockImplementation((v: unknown) => {
    captured = v;
    return { onConflict };
  });
  const insertInto = vi.fn().mockReturnValue({ values });
  return {
    db: { insertInto } as never,
    insertInto,
    onConflict,
    get captured() {
      return captured;
    },
  };
}

function makeUpdateChain() {
  const calls: { set?: unknown; where: unknown[][] } = { where: [] };
  const execute = vi.fn().mockResolvedValue(undefined);
  const chain = {
    set: vi.fn().mockImplementation((v: unknown) => {
      calls.set = v;
      return chain;
    }),
    where: vi.fn().mockImplementation((...args: unknown[]) => {
      calls.where.push(args);
      return chain;
    }),
    execute,
  };
  const updateTable = vi.fn().mockReturnValue(chain);
  return { db: { updateTable } as never, updateTable, calls };
}

describe('EasyTrackMotionRepository', () => {
  it('insert writes to easy_track_motion_meta, idempotent on proposal_id', () => {
    const chain = makeInsertChain();
    const repo = new EasyTrackMotionRepository(chain.db);
    void repo.insert(META);
    expect(chain.insertInto).toHaveBeenCalledWith('easy_track_motion_meta');
    expect(chain.captured).toBe(META);
    // exercise the onConflict builder
    const ocArg = chain.onConflict.mock.calls[0]?.[0] as (oc: {
      column: (c: string) => { doNothing: () => unknown };
    }) => unknown;
    const doNothing = vi.fn();
    ocArg({ column: () => ({ doNothing }) });
    expect(doNothing).toHaveBeenCalled();
  });

  it('setState updates the motion state by proposal_id', async () => {
    const { db, updateTable, calls } = makeUpdateChain();
    const repo = new EasyTrackMotionRepository(db);
    await repo.setState('p-1', 'enacted');
    expect(updateTable).toHaveBeenCalledWith('easy_track_motion_meta');
    expect(calls.set).toEqual({ state: 'enacted' });
    expect(calls.where).toEqual([['proposal_id', '=', 'p-1']]);
  });

  it('annotateObjected only moves an active motion to objected (guards against regressing terminals)', async () => {
    const { db, calls } = makeUpdateChain();
    const repo = new EasyTrackMotionRepository(db);
    await repo.annotateObjected('p-1');
    expect(calls.set).toEqual({ state: 'objected' });
    expect(calls.where).toEqual([
      ['proposal_id', '=', 'p-1'],
      ['state', '=', 'active'],
    ]);
  });
});
