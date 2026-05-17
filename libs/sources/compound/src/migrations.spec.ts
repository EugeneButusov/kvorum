import { pgDb } from '@libs/db';

// Sentinel thrown inside transaction to trigger intentional rollback.
class RollbackSignal extends Error {}

// These tests require a running Postgres instance (DATABASE_URL env var).
// They are skipped when DATABASE_URL is not set so the suite passes in
// environments without a DB (e.g. pure typecheck CI steps).
const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

afterAll(async () => {
  await pgDb.destroy();
});

// Must match compound_003_active_from_block.ts:GOVERNOR_BRAVO_DEPLOY_BLOCK.
// Verified via Etherscan tx 0x2fdbaee2ac15cfbe04ddb020f84f072fa353e5703a84a422d6ca3cf734dd1855.
const EXPECTED_BRAVO_DEPLOY_BLOCK = '12006099';
// Must match compound_003_active_from_block.ts:GOVERNOR_ALPHA_DEPLOY_BLOCK.
// Verified via Etherscan creation tx 0x817209a08caec3e9193afd48ba7a7a1ea5ccb3f8a9494446bfb0b43213efe81f.
const EXPECTED_ALPHA_DEPLOY_BLOCK = '9601459';

describeWithDb('compound_003_active_from_block migration', () => {
  it('up sets active_from_block exactly to the verified Bravo deploy block', async () => {
    const rows = await pgDb
      .selectFrom('dao_source')
      .select(['active_from_block'])
      .where('source_type', '=', 'compound_governor')
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.active_from_block).toBe(EXPECTED_BRAVO_DEPLOY_BLOCK);
  });

  it('up sets active_from_block exactly to the verified Alpha deploy block', async () => {
    const rows = await pgDb
      .selectFrom('dao_source')
      .select(['active_from_block'])
      .where('source_type', '=', 'compound_governor_alpha')
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.active_from_block).toBe(EXPECTED_ALPHA_DEPLOY_BLOCK);
  });

  it('down would revert active_from_block to NULL (simulated via transaction rollback)', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await tx
          .updateTable('dao_source')
          .set({ active_from_block: null })
          .where('source_type', 'in', ['compound_governor', 'compound_governor_alpha'])
          .execute();

        const rows = await tx
          .selectFrom('dao_source')
          .select(['active_from_block'])
          .where('source_type', 'in', ['compound_governor', 'compound_governor_alpha'])
          .execute();
        expect(rows.every((r) => r.active_from_block === null)).toBe(true);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);

    // Verify the rollback left the migrated values intact.
    const rows = await pgDb
      .selectFrom('dao_source')
      .select(['source_type', 'active_from_block'])
      .where('source_type', 'in', ['compound_governor', 'compound_governor_alpha'])
      .orderBy('source_type')
      .execute();
    expect(rows).toHaveLength(2);
    const bravo = rows.find((r) => r.source_type === 'compound_governor');
    const alpha = rows.find((r) => r.source_type === 'compound_governor_alpha');
    expect(bravo!.active_from_block).toBe(EXPECTED_BRAVO_DEPLOY_BLOCK);
    expect(alpha!.active_from_block).toBe(EXPECTED_ALPHA_DEPLOY_BLOCK);
  });
});
