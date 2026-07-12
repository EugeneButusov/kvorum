import { describe, expect, it, vi } from 'vitest';
import { UserRepository } from './user-repository';

describe('UserRepository', () => {
  it('findById queries users by id', async () => {
    const row = {
      id: 'u1',
      email: 'user@example.com',
      display_name: 'User One',
      role: 'user',
      banned_at: null,
      banned_reason: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-02T00:00:00Z'),
    };

    const executeTakeFirst = vi.fn().mockResolvedValue(row);
    const chain = {
      selectAll: vi.fn(),
      where: vi.fn(),
      executeTakeFirst,
    };
    chain.selectAll.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    const selectFrom = vi.fn().mockReturnValue(chain);

    const repo = new UserRepository({ selectFrom } as never);

    await expect(repo.findById('u1')).resolves.toEqual(row);
    expect(selectFrom).toHaveBeenCalledWith('users');
    expect(chain.where).toHaveBeenCalledWith('id', '=', 'u1');
  });

  it('findByWalletAddress lowercases the address before querying', async () => {
    const executeTakeFirst = vi.fn().mockResolvedValue(undefined);
    const chain = { selectAll: vi.fn(), where: vi.fn(), executeTakeFirst };
    chain.selectAll.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    const selectFrom = vi.fn().mockReturnValue(chain);

    const repo = new UserRepository({ selectFrom } as never);

    await repo.findByWalletAddress(`0x${'A'.repeat(40)}`);
    expect(selectFrom).toHaveBeenCalledWith('users');
    // The users_wallet_address_lowercase CHECK stores lowercased, so the lookup must lowercase too.
    expect(chain.where).toHaveBeenCalledWith('wallet_address', '=', `0x${'a'.repeat(40)}`);
  });

  it('create lowercases the email before inserting', async () => {
    const row = { id: 'u2', email: 'mixed@example.com' };
    const executeTakeFirstOrThrow = vi.fn().mockResolvedValue(row);
    const returningAll = vi.fn().mockReturnValue({ executeTakeFirstOrThrow });
    const values = vi.fn().mockReturnValue({ returningAll });
    const insertInto = vi.fn().mockReturnValue({ values });

    const repo = new UserRepository({ insertInto } as never);

    await repo.create({ email: 'Mixed@Example.COM', displayName: 'Mixed', role: 'user' });
    expect(insertInto).toHaveBeenCalledWith('users');
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'mixed@example.com', display_name: 'Mixed', role: 'user' }),
    );
  });

  it('setRecoveryEmail lowercases the email and returns ok', async () => {
    const execute = vi.fn(async () => []);
    const where = vi.fn().mockReturnValue({ execute });
    const set = vi.fn().mockReturnValue({ where });
    const updateTable = vi.fn().mockReturnValue({ set });

    const repo = new UserRepository({ updateTable } as never);

    await expect(repo.setRecoveryEmail('u1', 'Foo@Bar.COM')).resolves.toBe('ok');
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ email: 'foo@bar.com' }));
    expect(where).toHaveBeenCalledWith('id', '=', 'u1');
  });

  it('setRecoveryEmail returns conflict on a unique violation', async () => {
    const execute = vi.fn(async () => {
      throw { code: '23505' };
    });
    const where = vi.fn().mockReturnValue({ execute });
    const set = vi.fn().mockReturnValue({ where });
    const updateTable = vi.fn().mockReturnValue({ set });

    const repo = new UserRepository({ updateTable } as never);

    await expect(repo.setRecoveryEmail('u1', 'taken@example.com')).resolves.toBe('conflict');
  });

  it('upsertByWalletAddress inserts (lowercased) and returns the new row on the insert path', async () => {
    const inserted = { id: 'u3', wallet_address: `0x${'a'.repeat(40)}` };
    const oc = { column: vi.fn().mockReturnThis(), doNothing: vi.fn().mockReturnThis() };
    const executeTakeFirst = vi.fn().mockResolvedValue(inserted);
    const returningAll = vi.fn().mockReturnValue({ executeTakeFirst });
    const onConflict = vi.fn().mockImplementation((cb: (b: typeof oc) => unknown) => {
      cb(oc);
      return { returningAll };
    });
    const values = vi.fn().mockReturnValue({ onConflict });
    const insertInto = vi.fn().mockReturnValue({ values });

    const repo = new UserRepository({ insertInto } as never);

    await expect(
      repo.upsertByWalletAddress({ walletAddress: `0x${'A'.repeat(40)}` }),
    ).resolves.toBe(inserted);
    expect(insertInto).toHaveBeenCalledWith('users');
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ wallet_address: `0x${'a'.repeat(40)}`, role: 'user' }),
    );
    expect(oc.column).toHaveBeenCalledWith('wallet_address');
    expect(oc.doNothing).toHaveBeenCalled();
  });

  it('upsertByWalletAddress falls back to a lookup when the insert conflicts (DO NOTHING)', async () => {
    const existing = { id: 'u4', wallet_address: `0x${'b'.repeat(40)}` };
    // Insert path returns undefined (row already existed → DO NOTHING).
    const oc = { column: vi.fn().mockReturnThis(), doNothing: vi.fn().mockReturnThis() };
    const returningAll = vi.fn().mockReturnValue({
      executeTakeFirst: vi.fn().mockResolvedValue(undefined),
    });
    const onConflict = vi.fn().mockImplementation((cb: (b: typeof oc) => unknown) => {
      cb(oc);
      return { returningAll };
    });
    const insertInto = vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflict }) });
    // Fallback select path returns the existing row.
    const selectChain = {
      selectAll: vi.fn(),
      where: vi.fn(),
      executeTakeFirst: vi.fn().mockResolvedValue(existing),
    };
    selectChain.selectAll.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    const selectFrom = vi.fn().mockReturnValue(selectChain);

    const repo = new UserRepository({ insertInto, selectFrom } as never);

    await expect(
      repo.upsertByWalletAddress({ walletAddress: `0x${'B'.repeat(40)}` }),
    ).resolves.toBe(existing);
    // Fallback lookup uses the lowercased address.
    expect(selectChain.where).toHaveBeenCalledWith('wallet_address', '=', `0x${'b'.repeat(40)}`);
  });

  it('deleteAccount deletes the keys before the user, inside a transaction', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const where = vi.fn().mockReturnValue({ execute });
    const deleteFrom = vi.fn().mockReturnValue({ where });
    const trx = { deleteFrom };
    const transaction = vi.fn().mockReturnValue({
      execute: (cb: (t: typeof trx) => Promise<void>) => cb(trx),
    });

    const repo = new UserRepository({ transaction } as never);

    await repo.deleteAccount('u1');
    // FK is onDelete('restrict') → api_key must be deleted before users.
    expect(deleteFrom.mock.calls.map((c) => c[0])).toEqual(['api_key', 'users']);
    expect(where).toHaveBeenCalledWith('user_id', '=', 'u1');
    expect(where).toHaveBeenCalledWith('id', '=', 'u1');
  });
});
