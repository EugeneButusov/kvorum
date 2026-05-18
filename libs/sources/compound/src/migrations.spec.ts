import { sql } from 'kysely';
import { pgDb } from '@libs/db';
import { down, up } from '../migrations-postgres/compound_003_active_from_block';

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
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await sql`
          INSERT INTO dao (slug, name, primary_token_address, primary_chain_id,
                           description, website_url, forum_url, updated_at)
          VALUES ('compound', 'Compound', '0xc00e94cb662c3520282e6f5717214004a7f26888', '0x1',
                  'test', 'https://compound.finance', 'https://gov.compound.finance', now())
          ON CONFLICT (slug) DO NOTHING
        `.execute(tx);

        await sql`
          INSERT INTO dao_source (dao_id, source_type, source_config, active_from_block)
          SELECT id, 'compound_governor_bravo',
                 '{"governor_address":"0xc0Da02939E1441F497fd74F78cE7Decb17B66529"}'::jsonb, NULL
          FROM dao
          WHERE slug = 'compound'
          ON CONFLICT (dao_id, source_type) DO UPDATE SET active_from_block = NULL
        `.execute(tx);

        await up(tx);

        const rows = await tx
          .selectFrom('dao_source')
          .select(['active_from_block'])
          .where('source_type', '=', 'compound_governor_bravo')
          .execute();

        expect(rows).toHaveLength(1);
        expect(rows[0]!.active_from_block).toBe(EXPECTED_BRAVO_DEPLOY_BLOCK);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('up sets active_from_block exactly to the verified Alpha deploy block', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await sql`
          INSERT INTO dao (slug, name, primary_token_address, primary_chain_id,
                           description, website_url, forum_url, updated_at)
          VALUES ('compound', 'Compound', '0xc00e94cb662c3520282e6f5717214004a7f26888', '0x1',
                  'test', 'https://compound.finance', 'https://gov.compound.finance', now())
          ON CONFLICT (slug) DO NOTHING
        `.execute(tx);

        await sql`
          DELETE FROM dao_source
          WHERE source_type = 'compound_governor_alpha'
            AND dao_id = (SELECT id FROM dao WHERE slug = 'compound')
        `.execute(tx);

        await up(tx);

        const rows = await tx
          .selectFrom('dao_source')
          .select(['active_from_block'])
          .where('source_type', '=', 'compound_governor_alpha')
          .execute();

        expect(rows).toHaveLength(1);
        expect(rows[0]!.active_from_block).toBe(EXPECTED_ALPHA_DEPLOY_BLOCK);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('down would revert active_from_block to NULL (simulated via transaction rollback)', async () => {
    await expect(
      pgDb.transaction().execute(async (tx) => {
        await sql`
          INSERT INTO dao (slug, name, primary_token_address, primary_chain_id,
                           description, website_url, forum_url, updated_at)
          VALUES ('compound', 'Compound', '0xc00e94cb662c3520282e6f5717214004a7f26888', '0x1',
                  'test', 'https://compound.finance', 'https://gov.compound.finance', now())
          ON CONFLICT (slug) DO NOTHING
        `.execute(tx);

        await sql`
          INSERT INTO dao_source (dao_id, source_type, source_config, active_from_block)
          SELECT id, 'compound_governor_bravo',
                 '{"governor_address":"0xc0Da02939E1441F497fd74F78cE7Decb17B66529"}'::jsonb, NULL
          FROM dao
          WHERE slug = 'compound'
          ON CONFLICT (dao_id, source_type) DO UPDATE SET active_from_block = NULL
        `.execute(tx);

        await up(tx);
        await down(tx);

        const nulledRows = await tx
          .selectFrom('dao_source')
          .select(['active_from_block'])
          .where('source_type', 'in', ['compound_governor_bravo', 'compound_governor_alpha'])
          .where('dao_id', 'in', (eb) =>
            eb.selectFrom('dao').select('id').where('slug', '=', 'compound'),
          )
          .execute();
        expect(nulledRows.every((r) => r.active_from_block === null)).toBe(true);

        await up(tx);

        const rows = await tx
          .selectFrom('dao_source')
          .select(['source_type', 'active_from_block'])
          .where('source_type', 'in', ['compound_governor_bravo', 'compound_governor_alpha'])
          .where('dao_id', 'in', (eb) =>
            eb.selectFrom('dao').select('id').where('slug', '=', 'compound'),
          )
          .orderBy('source_type')
          .execute();
        expect(rows).toHaveLength(2);
        const bravo = rows.find((r) => r.source_type === 'compound_governor_bravo');
        const alpha = rows.find((r) => r.source_type === 'compound_governor_alpha');
        expect(bravo!.active_from_block).toBe(EXPECTED_BRAVO_DEPLOY_BLOCK);
        expect(alpha!.active_from_block).toBe(EXPECTED_ALPHA_DEPLOY_BLOCK);

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});
