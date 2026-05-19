import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// GovernorAlpha contract-creation block on Ethereum mainnet (2020-02-24).
// Verified via Etherscan creation tx
// 0x817209a08caec3e9193afd48ba7a7a1ea5ccb3f8a9494446bfb0b43213efe81f
// (creator "Compound: Deployer 3", 0xcec237e83a080f3225ab1562605ee6dedf5644cc).
// Contract-creation block (not first-event) for conservative range coverage.
export const GOVERNOR_ALPHA_DEPLOY_BLOCK = 9601459;

// GovernorBravoDelegator deployment block on Ethereum mainnet (2021-03-26).
// Verified via Etherscan tx 0x2fdbaee2ac15cfbe04ddb020f84f072fa353e5703a84a422d6ca3cf734dd1855.
// Contract-creation block (not first-event) for conservative range coverage.
export const GOVERNOR_BRAVO_DEPLOY_BLOCK = 12006099;

// CompoundGovernor (TransparentUpgradeableProxy) contract-creation block on
// Ethereum mainnet (2025-01-23). Verified via Etherscan creation tx
// 0xd08f5e9f6885bb6aa7519a6f8e2270e549208ec159102560bc517fb8aac490e5.
// Contract-creation block (not first-event) for conservative range coverage.
export const GOVERNOR_OZ_DEPLOY_BLOCK = 21688680;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO source_type (value)
    VALUES ('compound_governor_oz'),
           ('compound_governor_bravo_reconcile'),
           ('compound_governor_oz_reconcile')
    ON CONFLICT (value) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao (slug, name, primary_token_address, primary_chain_id,
                     description, website_url, forum_url, updated_at)
    VALUES (
      'compound',
      'Compound',
      '0xc00e94cb662c3520282e6f5717214004a7f26888',
      '0x1',
      'Compound is an algorithmic, autonomous interest rate protocol built for developers, to unlock a universe of open financial applications.',
      'https://compound.finance',
      'https://gov.compound.finance',
      now()
    )
    ON CONFLICT (slug) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, source_config, active_from_block)
    SELECT id,
           'compound_governor_bravo',
           '{"governor_address": "0xc0Da02939E1441F497fd74F78cE7Decb17B66529"}'::jsonb,
           ${sql.lit(GOVERNOR_BRAVO_DEPLOY_BLOCK)}
    FROM dao
    WHERE slug = 'compound'
    ON CONFLICT (dao_id, source_type) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, source_config, active_from_block)
    SELECT id,
           'compound_governor_alpha',
           '{"governor_address": "0xc0dA01a04C3f3E0be433606045bB7017A7323E38"}'::jsonb,
           ${sql.lit(GOVERNOR_ALPHA_DEPLOY_BLOCK)}
    FROM dao
    WHERE slug = 'compound'
    ON CONFLICT (dao_id, source_type) DO NOTHING
  `.execute(db);

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

  await sql`
    INSERT INTO dao_source (dao_id, source_type, source_config, active_from_block)
    SELECT dao_id, 'compound_governor_bravo_reconcile', source_config, active_from_block
    FROM dao_source
    WHERE source_type = 'compound_governor_bravo'
    ON CONFLICT (dao_id, source_type) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, source_config, active_from_block)
    SELECT dao_id, 'compound_governor_oz_reconcile', source_config, active_from_block
    FROM dao_source
    WHERE source_type = 'compound_governor_oz'
    ON CONFLICT (dao_id, source_type) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM dao_source
    WHERE source_type IN (
      'compound_governor_alpha',
      'compound_governor_bravo',
      'compound_governor_oz',
      'compound_governor_bravo_reconcile',
      'compound_governor_oz_reconcile'
    )
      AND dao_id = (SELECT id FROM dao WHERE slug = 'compound')
  `.execute(db);

  await sql`DELETE FROM dao WHERE slug = 'compound'`.execute(db);
}
