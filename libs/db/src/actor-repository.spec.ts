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

  return { selectFrom, selectAll, where, executeTakeFirst };
}

function makeJoinSelectChain(returnValue: unknown) {
  const executeTakeFirst = vi.fn().mockResolvedValue(returnValue);
  const where = vi.fn().mockReturnValue({ executeTakeFirst });
  const selectAll = vi.fn().mockReturnValue({ where });
  const innerJoin = vi.fn().mockReturnValue({ selectAll });
  const selectFrom = vi.fn().mockReturnValue({ innerJoin });

  return { selectFrom, innerJoin, selectAll, where, executeTakeFirst };
}

function makeInsertAddressChain() {
  let capturedValues: unknown;
  let capturedConflictColumns: string[] | undefined;
  const execute = vi.fn().mockResolvedValue(undefined);
  const onConflict = vi.fn().mockImplementation((fn: (oc: ConflictColumnsBuilder) => unknown) => {
    fn({
      columns: (columns) => {
        capturedConflictColumns = columns;
        return { doNothing: () => ({ execute }) };
      },
    });
    return { execute };
  });
  const values = vi.fn().mockImplementation((value: unknown) => {
    capturedValues = value;
    return { onConflict };
  });
  const insertInto = vi.fn().mockReturnValue({ values });

  return {
    insertInto,
    execute,
    get capturedValues() {
      return capturedValues;
    },
    get capturedConflictColumns() {
      return capturedConflictColumns;
    },
  };
}

interface ConflictBuilder {
  column(name: string): { doNothing(): unknown };
}

interface ConflictColumnsBuilder {
  columns(columns: string[]): { doNothing(): unknown };
}

describe('ActorRepository', () => {
  it('finds actor id by actor_address', async () => {
    const executeTakeFirst = vi.fn().mockResolvedValue({ actor_id: 'actor-1' });
    const where = vi.fn().mockReturnValue({ executeTakeFirst });
    const select = vi.fn().mockReturnValue({ where });
    const selectFrom = vi.fn().mockReturnValue({ select });
    const repo = new ActorRepository({ selectFrom } as never);

    await expect(repo.findIdByAddress('0xABCDEF')).resolves.toBe('actor-1');

    expect(selectFrom).toHaveBeenCalledWith('actor_address');
    expect(select).toHaveBeenCalledWith('actor_id');
    expect(where).toHaveBeenCalledWith('address', '=', '0xabcdef');
  });

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

  it('returns existing actor when address is already present in actor_address', async () => {
    const joinSelect = makeJoinSelectChain(ACTOR_ROW);
    const repo = new ActorRepository({
      transaction: vi.fn(() => ({
        execute: vi.fn((fn: (trx: unknown) => Promise<unknown>) =>
          fn({
            selectFrom: joinSelect.selectFrom,
          }),
        ),
      })),
    } as never);

    await expect(repo.findOrCreateActorAddress('0xABCDEF', 'voter_event')).resolves.toEqual(
      ACTOR_ROW,
    );
    expect(joinSelect.selectFrom).toHaveBeenCalledWith('actor as a');
    expect(joinSelect.where).toHaveBeenCalledWith('aa.address', '=', '0xabcdef');
  });

  it('creates actor and actor_address when address does not exist', async () => {
    const joinSelect = makeJoinSelectChain(undefined);
    const actorInsert = makeInsertChain(ACTOR_ROW);
    const actorSelect = makeSelectChain(ACTOR_ROW);
    const actorAddressInsert = makeInsertAddressChain();
    const selectFrom = vi.fn((table: string) => {
      if (table === 'actor as a') return { innerJoin: joinSelect.innerJoin };
      return { selectAll: actorSelect.selectAll };
    });
    const insertInto = vi.fn((table: string) => {
      if (table === 'actor') return { values: actorInsert.insertInto().values };
      return { values: actorAddressInsert.insertInto().values };
    });
    const repo = new ActorRepository({
      transaction: vi.fn(() => ({
        execute: vi.fn((fn: (trx: unknown) => Promise<unknown>) => fn({ selectFrom, insertInto })),
      })),
    } as never);

    await expect(repo.findOrCreateActorAddress('0xABCDEF', 'delegate_event')).resolves.toEqual(
      ACTOR_ROW,
    );
    expect(actorAddressInsert.capturedValues).toEqual({
      actor_id: 'actor-1',
      address: '0xabcdef',
      is_primary: true,
      source: 'delegate_event',
    });
    expect(actorAddressInsert.capturedConflictColumns).toEqual(['actor_id', 'address']);
  });
});
