import { pgDb } from './client';
import { UserRepository } from './user-repository';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

class RollbackSignal extends Error {}

// A lowercased 0x-prefixed 40-char string that satisfies the users_wallet_address_lowercase CHECK
// and is unique per test run.
function randomWallet(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `0x${rand.repeat(6).slice(0, 40)}`;
}

afterAll(async () => {
  await pgDb.destroy();
});

describeWithDb('UserRepository (integration)', () => {
  it('create() inserts an email account, lowercases the email, and leaves wallet_address null', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new UserRepository(trx as never);
        const rand = Math.random().toString(36).slice(2, 10);

        const created = await repo.create({
          email: `Mixed-${rand}@Example.COM`,
          displayName: 'Case Test',
          role: 'user',
        });

        expect(created.email).toBe(`mixed-${rand}@example.com`);
        expect(created.display_name).toBe('Case Test');
        expect(created.wallet_address).toBeNull();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('upsertByWalletAddress creates a wallet-only account (null email/display_name)', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new UserRepository(trx as never);
        const addr = randomWallet();

        const created = await repo.upsertByWalletAddress({ walletAddress: addr });

        expect(created.wallet_address).toBe(addr);
        expect(created.email).toBeNull();
        expect(created.display_name).toBeNull();
        expect(created.role).toBe('user');

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('upsertByWalletAddress is idempotent and case-insensitive (ON CONFLICT + fallback)', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new UserRepository(trx as never);
        const addr = randomWallet();

        const first = await repo.upsertByWalletAddress({ walletAddress: addr });
        // Upper-cased input for the SAME wallet must resolve to the SAME row — this exercises the
        // ON CONFLICT (wallet_address) DO NOTHING path and the fallback SELECT, and validates that
        // the unique constraint (not a partial index) is inferrable by ON CONFLICT.
        const second = await repo.upsertByWalletAddress({ walletAddress: addr.toUpperCase() });

        expect(second.id).toBe(first.id);
        expect(second.wallet_address).toBe(addr);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('findByWalletAddress lowercases the lookup and returns undefined for unknown addresses', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const repo = new UserRepository(trx as never);
        const addr = randomWallet();
        const created = await repo.upsertByWalletAddress({ walletAddress: addr });

        const found = await repo.findByWalletAddress(addr.toUpperCase());
        expect(found?.id).toBe(created.id);

        await expect(repo.findByWalletAddress(`0x${'f'.repeat(40)}`)).resolves.toBeUndefined();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
