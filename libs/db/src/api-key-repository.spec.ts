import { ApiKeyRepository } from './api-key-repository';

describe('ApiKeyRepository', () => {
  it('findActiveByHash returns undefined when row is not found', async () => {
    const executeTakeFirst = vi.fn(async () => undefined);
    const whereChain = { executeTakeFirst } as {
      where?: ReturnType<typeof vi.fn>;
      executeTakeFirst: typeof executeTakeFirst;
    };
    const where = vi.fn().mockImplementation(() => whereChain);
    whereChain.where = where;
    const select = vi.fn().mockReturnValue({ where });
    const innerJoin = vi.fn().mockReturnValue({ select });
    const selectFrom = vi.fn().mockReturnValue({ innerJoin });

    const repo = new ApiKeyRepository({ selectFrom } as never);

    await expect(repo.findActiveByHash(Buffer.alloc(32, 1))).resolves.toBeUndefined();
  });

  it('findActiveByHash maps the sanitized api key and user', async () => {
    const now = new Date();
    const executeTakeFirst = vi.fn(async () => ({
      api_key_id: 'k1',
      api_key_user_id: 'u1',
      api_key_prefix: 'kv_live_',
      api_key_last_four: '1234',
      api_key_tier: 'authenticated_free',
      api_key_label: 'test',
      api_key_created_at: now,
      api_key_last_used_at: null,
      api_key_revoked_at: null,
      api_key_expires_at: null,
      user_id: 'u1',
      user_email: 'test@example.com',
      user_display_name: 'Test',
      user_wallet_address: null,
      user_role: 'user',
      user_banned_at: null,
      user_banned_reason: null,
      user_created_at: now,
      user_updated_at: now,
    }));
    const whereChain = { executeTakeFirst } as {
      where?: ReturnType<typeof vi.fn>;
      executeTakeFirst: typeof executeTakeFirst;
    };
    const where = vi.fn().mockImplementation(() => whereChain);
    whereChain.where = where;
    const select = vi.fn().mockReturnValue({ where });
    const innerJoin = vi.fn().mockReturnValue({ select });
    const selectFrom = vi.fn().mockReturnValue({ innerJoin });

    const repo = new ApiKeyRepository({ selectFrom } as never);
    const result = await repo.findActiveByHash(Buffer.alloc(32, 1));

    expect(result).toEqual({
      apiKey: {
        id: 'k1',
        user_id: 'u1',
        prefix: 'kv_live_',
        last_four: '1234',
        tier: 'authenticated_free',
        label: 'test',
        created_at: now,
        last_used_at: null,
        revoked_at: null,
        expires_at: null,
      },
      user: {
        id: 'u1',
        email: 'test@example.com',
        display_name: 'Test',
        wallet_address: null,
        role: 'user',
        banned_at: null,
        banned_reason: null,
        created_at: now,
        updated_at: now,
      },
    });
  });

  it('findActiveByHash maps a wallet-only user (null email/display_name, wallet_address set)', async () => {
    const now = new Date();
    const wallet = `0x${'a'.repeat(40)}`;
    const executeTakeFirst = vi.fn(async () => ({
      api_key_id: 'k2',
      api_key_user_id: 'u2',
      api_key_prefix: 'kv_live_',
      api_key_last_four: 'wxyz',
      api_key_tier: 'dashboard',
      api_key_label: null,
      api_key_created_at: now,
      api_key_last_used_at: null,
      api_key_revoked_at: null,
      api_key_expires_at: null,
      user_id: 'u2',
      user_email: null,
      user_display_name: null,
      user_wallet_address: wallet,
      user_role: 'user',
      user_banned_at: null,
      user_banned_reason: null,
      user_created_at: now,
      user_updated_at: now,
    }));
    const whereChain = { executeTakeFirst } as {
      where?: ReturnType<typeof vi.fn>;
      executeTakeFirst: typeof executeTakeFirst;
    };
    const where = vi.fn().mockImplementation(() => whereChain);
    whereChain.where = where;
    const select = vi.fn().mockReturnValue({ where });
    const innerJoin = vi.fn().mockReturnValue({ select });
    const selectFrom = vi.fn().mockReturnValue({ innerJoin });

    const repo = new ApiKeyRepository({ selectFrom } as never);
    const result = await repo.findActiveByHash(Buffer.alloc(32, 2));

    expect(result?.user).toEqual({
      id: 'u2',
      email: null,
      display_name: null,
      wallet_address: wallet,
      role: 'user',
      banned_at: null,
      banned_reason: null,
      created_at: now,
      updated_at: now,
    });
    expect(result?.apiKey.tier).toBe('dashboard');
  });

  it('touchLastUsed issues update with debounce predicate', async () => {
    const execute = vi.fn(async () => []);
    const whereChain = { execute } as { where?: ReturnType<typeof vi.fn>; execute: typeof execute };
    const where = vi.fn().mockImplementation(() => whereChain);
    whereChain.where = where;
    const set = vi.fn().mockReturnValue({ where });
    const updateTable = vi.fn().mockReturnValue({ set });

    const repo = new ApiKeyRepository({ updateTable } as never);
    await repo.touchLastUsed('k1');

    expect(updateTable).toHaveBeenCalledWith('api_key');
    expect(set).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(2);
  });

  it('rehashKey swallows unique constraint violations', async () => {
    const execute = vi.fn(async () => {
      throw { code: '23505' };
    });
    const where = vi.fn().mockReturnValue({ execute });
    const set = vi.fn().mockReturnValue({ where });
    const updateTable = vi.fn().mockReturnValue({ set });

    const repo = new ApiKeyRepository({ updateTable } as never);
    await expect(repo.rehashKey('k1', Buffer.alloc(32, 1))).resolves.toBeUndefined();
  });

  it('rehashKey rethrows non-unique errors', async () => {
    const execute = vi.fn(async () => {
      throw new Error('boom');
    });
    const where = vi.fn().mockReturnValue({ execute });
    const set = vi.fn().mockReturnValue({ where });
    const updateTable = vi.fn().mockReturnValue({ set });

    const repo = new ApiKeyRepository({ updateTable } as never);
    await expect(repo.rehashKey('k1', Buffer.alloc(32, 1))).rejects.toThrow('boom');
  });
});
