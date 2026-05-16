import { generateApiKey, hashApiKey } from '@libs/auth';
import { ApiKeyRepository } from './api-key-repository';
import { pgDb } from './client';

const TEST_PEPPER = Buffer.alloc(32, 0xff);

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

class RollbackSignal extends Error {}

async function seedUserAndApiKey(
  trx: typeof pgDb,
  opts?: { revoked?: boolean; lastUsedAt?: Date | null; keyHash?: Buffer },
) {
  const rand = Math.random().toString(36).slice(2, 10);
  const [user] = await trx
    .insertInto('users')
    .values({
      email: `api-key-spec-${rand}@example.com`,
      display_name: `API Key Spec ${rand}`,
      role: 'user',
      updated_at: new Date(),
    })
    .returning(['id'])
    .execute();

  const [apiKey] = await trx
    .insertInto('api_key')
    .values({
      user_id: user!.id,
      key_hash: opts?.keyHash ?? Buffer.alloc(32, 1),
      prefix: 'kv_live_',
      last_four: 'abcd',
      tier: 'authenticated_free',
      label: 'spec',
      last_used_at: opts?.lastUsedAt ?? null,
      revoked_at: opts?.revoked ? new Date() : null,
    })
    .returning(['id', 'key_hash'])
    .execute();

  return { userId: user!.id, apiKeyId: apiKey!.id, keyHash: apiKey!.key_hash };
}

afterAll(async () => {
  await pgDb.destroy();
});

describeWithDb('ApiKeyRepository (integration)', () => {
  it('findActiveByHash returns active row with user fields and no key_hash', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const seeded = await seedUserAndApiKey(trx);
        const repo = new ApiKeyRepository(trx as never);

        const row = await repo.findActiveByHash(seeded.keyHash);

        expect(row).toBeDefined();
        expect(row?.apiKey.id).toBe(seeded.apiKeyId);
        expect(row?.apiKey.user_id).toBe(seeded.userId);
        expect(row?.user.email).toContain('@example.com');
        expect(row?.apiKey).not.toHaveProperty('key_hash');

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('findActiveByHash returns undefined for revoked and unknown keys', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const revoked = await seedUserAndApiKey(trx, {
          revoked: true,
          keyHash: Buffer.alloc(32, 9),
        });
        const repo = new ApiKeyRepository(trx as never);

        await expect(repo.findActiveByHash(revoked.keyHash)).resolves.toBeUndefined();
        await expect(repo.findActiveByHash(Buffer.alloc(32, 8))).resolves.toBeUndefined();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('touchLastUsed updates when NULL and when older than 60s, but not within 60s', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new ApiKeyRepository(trx as never);

        const neverUsed = await seedUserAndApiKey(trx, {
          keyHash: Buffer.alloc(32, 2),
          lastUsedAt: null,
        });
        await repo.touchLastUsed(neverUsed.apiKeyId);
        const afterNull = await trx
          .selectFrom('api_key')
          .select(['last_used_at'])
          .where('id', '=', neverUsed.apiKeyId)
          .executeTakeFirstOrThrow();
        expect(afterNull.last_used_at).not.toBeNull();

        const oldDate = new Date(Date.now() - 120_000);
        const oldUsed = await seedUserAndApiKey(trx, {
          keyHash: Buffer.alloc(32, 3),
          lastUsedAt: oldDate,
        });
        await repo.touchLastUsed(oldUsed.apiKeyId);
        const afterOld = await trx
          .selectFrom('api_key')
          .select(['last_used_at'])
          .where('id', '=', oldUsed.apiKeyId)
          .executeTakeFirstOrThrow();
        expect(afterOld.last_used_at).not.toBeNull();
        expect(afterOld.last_used_at!.getTime()).toBeGreaterThan(oldDate.getTime());

        const recentDate = new Date(Date.now() - 1_000);
        const recentUsed = await seedUserAndApiKey(trx, {
          keyHash: Buffer.alloc(32, 4),
          lastUsedAt: recentDate,
        });
        await repo.touchLastUsed(recentUsed.apiKeyId);
        const afterRecent = await trx
          .selectFrom('api_key')
          .select(['last_used_at'])
          .where('id', '=', recentUsed.apiKeyId)
          .executeTakeFirstOrThrow();
        expect(afterRecent.last_used_at?.getTime()).toBe(recentDate.getTime());

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('touchLastUsed handles concurrent calls without errors', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const oldDate = new Date(Date.now() - 120_000);
        const seeded = await seedUserAndApiKey(trx, {
          keyHash: Buffer.alloc(32, 5),
          lastUsedAt: oldDate,
        });
        const repo = new ApiKeyRepository(trx as never);

        await expect(
          Promise.all([repo.touchLastUsed(seeded.apiKeyId), repo.touchLastUsed(seeded.apiKeyId)]),
        ).resolves.toEqual([undefined, undefined]);

        const row = await trx
          .selectFrom('api_key')
          .select(['last_used_at'])
          .where('id', '=', seeded.apiKeyId)
          .executeTakeFirstOrThrow();
        expect(row.last_used_at).not.toBeNull();
        expect(row.last_used_at!.getTime()).toBeGreaterThan(oldDate.getTime());

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('rehashKey updates lookup to new hash and old hash no longer matches', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const oldHash = Buffer.alloc(32, 6);
        const newHash = Buffer.alloc(32, 7);
        const seeded = await seedUserAndApiKey(trx, { keyHash: oldHash });
        const repo = new ApiKeyRepository(trx as never);

        await repo.rehashKey(seeded.apiKeyId, newHash);

        await expect(repo.findActiveByHash(oldHash)).resolves.toBeUndefined();
        const updated = await repo.findActiveByHash(newHash);
        expect(updated?.apiKey.id).toBe(seeded.apiKeyId);

        // no-op update to same hash should not throw
        await expect(repo.rehashKey(seeded.apiKeyId, newHash)).resolves.toBeUndefined();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('create() + findActiveByHash() — minted key authenticates end-to-end', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const [user] = await trx
          .insertInto('users')
          .values({
            email: `minted-key-spec-${Date.now()}@example.com`,
            display_name: 'Minted Key Spec',
            role: 'user',
            updated_at: new Date(),
          })
          .returning(['id'])
          .execute();

        const repo = new ApiKeyRepository(trx as never);
        const generated = generateApiKey();
        const keyHash = hashApiKey(TEST_PEPPER, generated.key);

        const created = await repo.create({
          userId: user!.id,
          keyHash,
          prefix: generated.prefix,
          lastFour: generated.lastFour,
          label: 'e2e-spec',
          tier: 'authenticated_free',
        });

        expect(created.id).toBeDefined();
        expect(created.prefix).toBe(generated.prefix);
        expect(created.last_four).toBe(generated.lastFour);
        expect(created).not.toHaveProperty('key_hash');

        // The minted key must be findable using the same pepper
        const found = await repo.findActiveByHash(hashApiKey(TEST_PEPPER, generated.key));
        expect(found?.apiKey.id).toBe(created.id);
        expect(found?.apiKey.user_id).toBe(user!.id);
        expect(found?.user.id).toBe(user!.id);

        // A different pepper must not match
        const wrongPepper = Buffer.alloc(32, 0x01);
        const notFound = await repo.findActiveByHash(hashApiKey(wrongPepper, generated.key));
        expect(notFound).toBeUndefined();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('revoke() transitions key to revoked state and is idempotent', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const seeded = await seedUserAndApiKey(trx, { keyHash: Buffer.alloc(32, 10) });
        const repo = new ApiKeyRepository(trx as never);

        expect(await repo.revoke(seeded.apiKeyId)).toBe('revoked');
        expect(await repo.revoke(seeded.apiKeyId)).toBe('already_revoked');
        expect(await repo.revoke('00000000-0000-0000-0000-000000000000')).toBe('not_found');

        // revoked key must not be findable
        await expect(repo.findActiveByHash(seeded.keyHash)).resolves.toBeUndefined();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('listByUser() returns keys without key_hash and filters by user', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const seeded = await seedUserAndApiKey(trx, { keyHash: Buffer.alloc(32, 11) });
        const repo = new ApiKeyRepository(trx as never);

        const all = await repo.listByUser();
        expect(all.some((k) => k.id === seeded.apiKeyId)).toBe(true);
        expect(all.every((k) => !('key_hash' in k))).toBe(true);

        const filtered = await repo.listByUser(seeded.userId);
        expect(filtered.every((k) => k.user_id === seeded.userId)).toBe(true);

        const empty = await repo.listByUser('00000000-0000-0000-0000-000000000000');
        expect(empty).toHaveLength(0);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
