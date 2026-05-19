import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// CompoundGovernor (TransparentUpgradeableProxy) contract-creation block on
// Ethereum mainnet (2025-01-23). Verified via Etherscan creation tx
// 0xd08f5e9f6885bb6aa7519a6f8e2270e549208ec159102560bc517fb8aac490e5.
// Contract-creation block (not first-event) for conservative range coverage.
export const GOVERNOR_OZ_DEPLOY_BLOCK = 21688680;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`INSERT INTO source_type (value)
            VALUES ('compound_governor_oz')
            ON CONFLICT (value) DO NOTHING`.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, source_config, active_from_block)
    SELECT id,
           'compound_governor_oz',
           '{"governor_address": "0x309a862bbC1A00e45506cB8A802D1ff10004c8C0"}'::jsonb,
           ${sql.lit(GOVERNOR_OZ_DEPLOY_BLOCK)}
    FROM dao
    WHERE slug = 'compound'
    ON CONFLICT (dao_id, source_type) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM dao_source
    WHERE source_type = 'compound_governor_oz'
      AND dao_id = (SELECT id FROM dao WHERE slug = 'compound')
  `.execute(db);
  await sql`DELETE FROM source_type WHERE value = 'compound_governor_oz'`.execute(db);
}
