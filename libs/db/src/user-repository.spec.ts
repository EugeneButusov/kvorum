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
});
