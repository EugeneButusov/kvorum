import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// GovernorBravoDelegator deployment block on Ethereum mainnet (2021-03-26).
// Verified via Etherscan tx 0x2fdbaee2ac15cfbe04ddb020f84f072fa353e5703a84a422d6ca3cf734dd1855.
// Using the contract-creation block (not the first-event block) for conservative range coverage.
export const GOVERNOR_BRAVO_DEPLOY_BLOCK = 12006099;

// GovernorAlpha contract-creation block on Ethereum mainnet (2020-02-24).
// Verified via Etherscan creation tx
// 0x817209a08caec3e9193afd48ba7a7a1ea5ccb3f8a9494446bfb0b43213efe81f
// Must stay in sync with compound_002_dao_seed.ts:GOVERNOR_ALPHA_DEPLOY_BLOCK.
export const GOVERNOR_ALPHA_DEPLOY_BLOCK = 9601459;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE dao_source
    SET active_from_block = ${sql.lit(GOVERNOR_BRAVO_DEPLOY_BLOCK)}
    WHERE source_type = 'compound_governor_bravo'
  `.execute(db);

  // Upsert: existing installs may not have the compound_governor_alpha row if
  // compound_002 was applied before alpha support was added. New installs already
  // have it from compound_002; the DO UPDATE is a no-op for them.
  await sql`
    INSERT INTO dao_source (dao_id, source_type, source_config, active_from_block)
    SELECT id,
           'compound_governor_alpha',
           '{"governor_address": "0xc0dA01a04C3f3E0be433606045bB7017A7323E38"}'::jsonb,
           ${sql.lit(GOVERNOR_ALPHA_DEPLOY_BLOCK)}
    FROM dao
    WHERE slug = 'compound'
    ON CONFLICT (dao_id, source_type) DO UPDATE
      SET active_from_block = ${sql.lit(GOVERNOR_ALPHA_DEPLOY_BLOCK)}
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE dao_source
    SET active_from_block = NULL
    WHERE source_type IN ('compound_governor_bravo', 'compound_governor_alpha')
  `.execute(db);
}
