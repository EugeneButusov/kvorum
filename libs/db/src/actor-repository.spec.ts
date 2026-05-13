import { describe, expect, it, vi } from 'vitest';
import { ActorRepository } from './actor-repository';

const ACTOR_ROW = {
  id: 'actor-1',
  primary_address: '0xabcdef',
  display_name: null,
  bio: null,
  profile_data: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

function makeInsertChain(returnValue: unknown) {
  let capturedValues: unknown;
  let capturedConflictColumn: string | undefined;
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const returningAll = vi.fn().mockReturnValue({ executeTakeFirst });
  const onConflict = vi.fn().mockImplementation((fn: (oc: ConflictBuilder) => unknown) => {
    fn({
      column: (name) => {
        capturedConflictColumn = name;
        return { doNothing: () => ({ returningAll }) };
      },
    });
    return { returningAll };
  });
  const values = vi.fn().mockImplementation((value: unknown) => {
    capturedValues = value;
    return { onConflict };
  });
  const insertInto = vi.fn().mockReturnValue({ values });

  return {
    insertInto,
    executeTakeFirst,
    get capturedValues() {
      return capturedValues;
    },
    get capturedConflictColumn() {
      return capturedConflictColumn;
    },
  };
}

function makeSelectChain(returnValue: unknown) {
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const where = vi.fn().mockReturnValue({ executeTakeFirst });
  const selectAll = vi.fn().mockReturnValue({ where });
  const selectFrom = vi.fn().mockReturnValue({ selectAll });

  return { selectFrom, where, executeTakeFirst };
}

interface ConflictBuilder {
  column(name: string): { doNothing(): unknown };
}

describe('ActorRepository', () => {
  it('normalizes address and returns the inserted actor', async () => {
    const insert = makeInsertChain(ACTOR_ROW);
    const repo = new ActorRepository({ insertInto: insert.insertInto } as never);

    await expect(repo.findOrCreateByAddress('0xABCDEF')).resolves.toEqual(ACTOR_ROW);

    expect(insert.insertInto).toHaveBeenCalledWith('actor');
    expect(insert.capturedValues).toMatchObject({ primary_address: '0xabcdef' });
    expect(insert.capturedConflictColumn).toBe('primary_address');
  });

  it('selects the existing actor when insert conflicts', async () => {
    const insert = makeInsertChain(undefined);
    const select = makeSelectChain(ACTOR_ROW);
    const repo = new ActorRepository({
      insertInto: insert.insertInto,
      selectFrom: select.selectFrom,
    } as never);

    await expect(repo.findOrCreateByAddress('0xABCDEF')).resolves.toEqual(ACTOR_ROW);

    expect(select.selectFrom).toHaveBeenCalledWith('actor');
    expect(select.where).toHaveBeenCalledWith('primary_address', '=', '0xabcdef');
  });

  it('throws if a conflict row cannot be re-selected', async () => {
    const insert = makeInsertChain(undefined);
    const select = makeSelectChain(undefined);
    const repo = new ActorRepository({
      insertInto: insert.insertInto,
      selectFrom: select.selectFrom,
    } as never);

    await expect(repo.findOrCreateByAddress('0xABCDEF')).rejects.toThrow(
      'actor insert conflicted but row was not found: 0xabcdef',
    );
  });
});
