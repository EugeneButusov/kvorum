import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Kysely<unknown> prevents the typed query builder — raw sql is intentional here.
// GovernorAlpha contract-creation block on Ethereum mainnet (2020-02-24).
// Verified via Etherscan creation tx
// 0x817209a08caec3e9193afd48ba7a7a1ea5ccb3f8a9494446bfb0b43213efe81f
// (creator "Compound: Deployer 3", 0xcec237e83a080f3225ab1562605ee6dedf5644cc).
// Contract-creation block (not first-event) for conservative range coverage.
export const GOVERNOR_ALPHA_DEPLOY_BLOCK = 9601459;

export async function up(db: Kysely<unknown>): Promise<void> {
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
    INSERT INTO dao_source (dao_id, source_type, source_config)
    SELECT id,
           'compound_governor',
           '{"governor_address": "0xc0Da02939E1441F497fd74F78cE7Decb17B66529"}'::jsonb
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
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM dao_source
    WHERE source_type = 'compound_governor_alpha'
      AND dao_id = (SELECT id FROM dao WHERE slug = 'compound')
  `.execute(db);

  await sql`
    DELETE FROM dao_source
    WHERE source_type = 'compound_governor'
      AND dao_id = (SELECT id FROM dao WHERE slug = 'compound')
  `.execute(db);

  await sql`DELETE FROM dao WHERE slug = 'compound'`.execute(db);
}
