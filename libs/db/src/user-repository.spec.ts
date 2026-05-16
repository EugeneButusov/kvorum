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
});
