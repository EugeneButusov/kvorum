import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Forum source seed: the `discourse_forum` source_type + the Aave/Compound forum dao_sources.
//
// Migration ordering note: forum_* sorts BEFORE lido_* and snapshot_*, so the `lido` dao does not
// exist yet when this runs — Lido's forum dao_source is therefore seeded in lido_004_seed (which
// owns the `lido` dao row), not here. Aave (aave_002) and Compound (compound_002) daos already
// exist. ADR-064 / ADR-0073: off-chain sources bind by host in source_config; chain_id is the
// `off-chain` sentinel. Forum is consumed by AE2 (no plugin yet) — tolerated at startup per
// ADR-0073.

const COMPOUND_FORUM_URL = 'https://www.comp.xyz';
const COMPOUND_FORUM_URL_PRE_Z5 = 'https://gov.compound.finance';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO source_type (value)
    VALUES ('discourse_forum')
    ON CONFLICT (value) DO NOTHING
  `.execute(db);

  // Compound's seeded forum_url (gov.compound.finance) is dead/NXDOMAIN; the live Discourse host
  // is www.comp.xyz (AE2 target).
  await sql`
    UPDATE dao SET forum_url = ${COMPOUND_FORUM_URL} WHERE slug = 'compound'
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config)
    SELECT id,
           'discourse_forum',
           'off-chain',
           ${sql.lit(JSON.stringify({ host: 'governance.aave.com', categories: ['governance'] }))}::jsonb
    FROM dao
    WHERE slug = 'aave'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config)
    SELECT id,
           'discourse_forum',
           'off-chain',
           ${sql.lit(JSON.stringify({ host: 'www.comp.xyz', categories: ['governance', 'proposals'] }))}::jsonb
    FROM dao
    WHERE slug = 'compound'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Remove the Aave/Compound discourse_forum dao_sources BEFORE the source_type they reference.
  // Lido's discourse_forum row is removed by lido_004_seed (rolls back earlier).
  await sql`
    DELETE FROM dao_source
    WHERE source_type = 'discourse_forum'
      AND dao_id IN (SELECT id FROM dao WHERE slug IN ('aave', 'compound'))
  `.execute(db);

  await sql`DELETE FROM source_type WHERE value = 'discourse_forum'`.execute(db);

  await sql`
    UPDATE dao SET forum_url = ${COMPOUND_FORUM_URL_PRE_Z5} WHERE slug = 'compound'
  `.execute(db);
}
