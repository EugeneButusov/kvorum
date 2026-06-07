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
  it('lists actor addresses ordered by primary first then address asc', async () => {
    const rows = [
      { actor_id: 'actor-1', address: '0xaaa', is_primary: true, source: 'voter_event' },
      { actor_id: 'actor-1', address: '0xbbb', is_primary: false, source: 'delegate_event' },
    ];
    const execute = vi.fn().mockResolvedValue(rows);
    const orderByAddress = vi.fn().mockReturnValue({ execute });
    const orderByPrimary = vi.fn().mockReturnValue({ orderBy: orderByAddress });
    const where = vi.fn().mockReturnValue({ orderBy: orderByPrimary });
    const selectAll = vi.fn().mockReturnValue({ where });
    const selectFrom = vi.fn().mockReturnValue({ selectAll });
    const repo = new ActorRepository({ selectFrom } as never);

    await expect(repo.listAddressesForActor('actor-1')).resolves.toEqual(rows);
    expect(selectFrom).toHaveBeenCalledWith('actor_address');
    expect(where).toHaveBeenCalledWith('actor_id', '=', 'actor-1');
    expect(orderByPrimary).toHaveBeenCalledWith('is_primary', 'desc');
    expect(orderByAddress).toHaveBeenCalledWith('address', 'asc');
  });

  it('returns empty list when actor has no addresses', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const orderByAddress = vi.fn().mockReturnValue({ execute });
    const orderByPrimary = vi.fn().mockReturnValue({ orderBy: orderByAddress });
    const where = vi.fn().mockReturnValue({ orderBy: orderByPrimary });
    const selectAll = vi.fn().mockReturnValue({ where });
    const selectFrom = vi.fn().mockReturnValue({ selectAll });
    const repo = new ActorRepository({ selectFrom } as never);

    await expect(repo.listAddressesForActor('missing-actor')).resolves.toEqual([]);
  });

  it('returns empty list when findPrimaryAddressesByActorIds receives no actor ids', async () => {
    const selectFrom = vi.fn();
    const repo = new ActorRepository({ selectFrom } as never);

    await expect(repo.findPrimaryAddressesByActorIds([])).resolves.toEqual([]);
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it('lists primary addresses for provided actor ids', async () => {
    const execute = vi.fn().mockResolvedValue([{ actor_id: 'actor-1', address: '0xabc' }]);
    const wherePrimary = vi.fn().mockReturnValue({ execute });
    const whereActorIds = vi.fn().mockReturnValue({ where: wherePrimary });
    const select = vi.fn().mockReturnValue({ where: whereActorIds });
    const selectFrom = vi.fn().mockReturnValue({ select });
    const repo = new ActorRepository({ selectFrom } as never);

    await expect(repo.findPrimaryAddressesByActorIds(['actor-1', 'actor-2'])).resolves.toEqual([
      { actor_id: 'actor-1', address: '0xabc' },
    ]);

    expect(selectFrom).toHaveBeenCalledWith('actor_address');
    expect(select).toHaveBeenCalledWith(['actor_id', 'address']);
    expect(whereActorIds).toHaveBeenCalledWith('actor_id', 'in', ['actor-1', 'actor-2']);
    expect(wherePrimary).toHaveBeenCalledWith('is_primary', '=', true);
  });

  it('finds ENS refresh candidates with ttlSeconds=0 without stale filter', async () => {
    const execute = vi.fn().mockResolvedValue([{ id: 'actor-1', primary_address: '0xabc' }]);
    const limit = vi.fn().mockReturnValue({ execute });
    const orderById = vi.fn().mockReturnValue({ limit });
    const orderByUpdated = vi.fn().mockReturnValue({ orderBy: orderById });
    const whereMerged = vi.fn().mockReturnValue({ orderBy: orderByUpdated });
    const select = vi.fn().mockReturnValue({ where: whereMerged });
    const selectFrom = vi.fn().mockReturnValue({ select });
    const repo = new ActorRepository({ selectFrom } as never);

    await expect(repo.findEnsRefreshCandidates({ limit: 50, ttlSeconds: 0 })).resolves.toEqual([
      { id: 'actor-1', primary_address: '0xabc' },
    ]);

    expect(selectFrom).toHaveBeenCalledWith('actor');
    expect(select).toHaveBeenCalledWith(['id', 'primary_address']);
    expect(whereMerged).toHaveBeenCalledWith('merged_into_actor_id', 'is', null);
    expect(orderByUpdated).toHaveBeenCalledWith('updated_at', 'asc');
    expect(orderById).toHaveBeenCalledWith('id', 'asc');
    expect(limit).toHaveBeenCalledWith(50);
  });

  it('updates display_name and touches updated_at for non-merged actors', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const whereMerged = vi.fn().mockReturnValue({ execute });
    const whereId = vi.fn().mockReturnValue({ where: whereMerged });
    const set = vi.fn().mockReturnValue({ where: whereId });
    const updateTable = vi.fn().mockReturnValue({ set });
    const repo = new ActorRepository({ updateTable } as never);

    await expect(
      repo.updateDisplayName({ actorId: 'actor-1', displayName: 'alice.eth' }),
    ).resolves.toBeUndefined();

    expect(updateTable).toHaveBeenCalledWith('actor');
    expect(whereId).toHaveBeenCalledWith('id', '=', 'actor-1');
    expect(whereMerged).toHaveBeenCalledWith('merged_into_actor_id', 'is', null);
  });

  it('finds actor by actor_address', async () => {
    const executeTakeFirst = vi.fn().mockResolvedValue(ACTOR_ROW);
    const where = vi.fn().mockReturnValue({ executeTakeFirst });
    const selectAll = vi.fn().mockReturnValue({ where });
    const innerJoin = vi.fn().mockReturnValue({ selectAll });
    const selectFrom = vi.fn().mockReturnValue({ innerJoin });
    const repo = new ActorRepository({ selectFrom } as never);

    await expect(repo.findByAddress('0xABCDEF')).resolves.toEqual(ACTOR_ROW);

    expect(selectFrom).toHaveBeenCalledWith('actor as a');
    expect(innerJoin).toHaveBeenCalledWith('actor_address as aa', 'aa.actor_id', 'a.id');
    expect(selectAll).toHaveBeenCalledWith('a');
    expect(where).toHaveBeenCalledWith('aa.address', '=', '0xabcdef');
  });

  it('finds actor id by actor_address', async () => {
    const joinSelect = makeJoinSelectChain(ACTOR_ROW);
    const repo = new ActorRepository({ selectFrom: joinSelect.selectFrom } as never);

    await expect(repo.findIdByAddress('0xABCDEF')).resolves.toBe('actor-1');
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
      selectFrom: joinSelect.selectFrom,
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
      selectFrom,
      insertInto,
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

  it('loads an actor overview with deduplicated addresses and redirects', async () => {
    const rows = [
      {
        actorId: 'actor-1',
        primaryAddress: '0xaaa',
        mergedIntoActorId: null,
        address: '0xaaa',
        isPrimary: true,
        source: 'manual',
        fromAddress: '0x111',
        toActorId: 'actor-1',
        mergedAt: new Date('2026-05-01T00:00:00Z'),
        mergeReason: 'delegate consolidation',
        createdBy: 'alice',
      },
      {
        actorId: 'actor-1',
        primaryAddress: '0xaaa',
        mergedIntoActorId: null,
        address: '0xbbb',
        isPrimary: false,
        source: 'manual',
        fromAddress: '0x111',
        toActorId: 'actor-1',
        mergedAt: new Date('2026-05-01T00:00:00Z'),
        mergeReason: 'delegate consolidation',
        createdBy: 'alice',
      },
    ];
    const execute = vi.fn().mockResolvedValue(rows);
    const chain = {
      innerJoin: vi.fn(),
      leftJoin: vi.fn(),
      select: vi.fn(),
      where: vi.fn(),
      execute,
    };
    chain.innerJoin.mockReturnValue(chain);
    chain.leftJoin.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    const selectFrom = vi.fn().mockReturnValue(chain);
    const repo = new ActorRepository({ selectFrom } as never);

    await expect(repo.findActorOverview('0xAAA')).resolves.toEqual({
      actorId: 'actor-1',
      primaryAddress: '0xaaa',
      mergedIntoActorId: null,
      addresses: [
        { address: '0xaaa', isPrimary: true, source: 'manual' },
        { address: '0xbbb', isPrimary: false, source: 'manual' },
      ],
      inboundRedirects: [
        {
          fromAddress: '0x111',
          toActorId: 'actor-1',
          mergedAt: new Date('2026-05-01T00:00:00Z'),
          mergeReason: 'delegate consolidation',
          createdBy: 'alice',
        },
      ],
    });
    expect(selectFrom).toHaveBeenCalledWith('actor as a');
    expect(chain.innerJoin).toHaveBeenCalledWith(
      'actor_address as lookup',
      'lookup.actor_id',
      'a.id',
    );
  });
});
