import { pgDb } from './client';

// Sentinel thrown inside transaction to trigger intentional rollback.
class RollbackSignal extends Error {}

// These tests require a running Postgres instance (DATABASE_URL env var).
// They are skipped when DATABASE_URL is not set so the suite passes in
// environments without a DB (e.g. pure typecheck CI steps).
const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

describeWithDb('auth schema smoke test', () => {
  afterAll(async () => {
    await pgDb.destroy();
  });

  it('inserts users, api_key, admin_audit rows and rolls back', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        const [user] = await tx
          .insertInto('users')
          .values({
            email: 'smoke@example.com',
            display_name: 'Smoke User',
            role: 'admin',
            updated_at: new Date(),
          })
          .returning(['id'])
          .execute();

        await tx
          .insertInto('api_key')
          .values({
            user_id: user!.id,
            key_hash: Buffer.from('a'.repeat(32)),
            prefix: 'kv_live_',
            last_four: 'abcd',
            tier: 'authenticated_free',
          })
          .execute();

        await tx
          .insertInto('admin_audit')
          .values({
            command: 'keys create',
            args: { label: 'smoke' },
            executor: 'smoke@example.com',
            executor_kind: 'ssh',
          })
          .execute();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);

    // Verify no rows persisted after rollback.
    const users = await pgDb
      .selectFrom('users')
      .where('email', '=', 'smoke@example.com')
      .selectAll()
      .execute();
    expect(users).toHaveLength(0);
  });
});
