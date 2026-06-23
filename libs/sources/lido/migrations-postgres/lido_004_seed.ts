import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Lido DAO seed: the `lido` dao row + all of Lido's dao_source rows.
//
// Migration ordering note (filenames sort alphabetically, applied in that order):
//   forum_002_seed (creates `discourse_forum` source_type) → lido_004_seed → snapshot_002_seed.
// So at this point `aragon_voting` (lido_001) and `discourse_forum` (forum_002) source_types
// already exist, and we can reference them. Lido's `snapshot` dao_source is NOT here — it lives
// in snapshot_002_seed because the `snapshot` source_type is created in snapshot_001 (which sorts
// AFTER lido_004). This migration owns the `lido` dao row, so every Lido dao_source that can be
// expressed here is kept here for cohesion.

// Lido Aragon Voting proxy (two-phase fork). Created at block 11473216 (tx 0x3feabd79…,
// 2020-12-17). active_from_block is the contract-creation block so backfill starts from genesis.
const ARAGON_VOTING_ADDRESS = '0x2e59A20f205bB85a89C53f1936454680651E618e';
const ARAGON_VOTING_DEPLOY_BLOCK = 11473216;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO source_type (value)
    VALUES ('aragon_voting_reconcile')
    ON CONFLICT (value) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao (slug, name, primary_token_address, primary_chain_id,
                     description, website_url, forum_url, updated_at)
    VALUES (
      'lido',
      'Lido',
      '0x5a98fcbea516cf06857215779fd812ca3bef1b32',
      '0x1',
      'Lido is a liquid staking protocol for Ethereum, governed by the Lido DAO and the LDO token.',
      'https://lido.fi',
      'https://research.lido.fi',
      now()
    )
    ON CONFLICT (slug) DO NOTHING
  `.execute(db);

  // Aragon Voting (binding LDO governance) on mainnet.
  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT id,
           'aragon_voting',
           '0x1',
           ${sql.lit(JSON.stringify({ voting_address: ARAGON_VOTING_ADDRESS }))}::jsonb,
           ${sql.lit(ARAGON_VOTING_DEPLOY_BLOCK)}
    FROM dao
    WHERE slug = 'lido'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);

  // Reconcile binding: copy the base aragon_voting row (getVote re-query source).
  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT dao_id, 'aragon_voting_reconcile', chain_id, source_config, active_from_block
    FROM dao_source
    WHERE source_type = 'aragon_voting'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);

  // Lido forum (Discourse). discourse_forum source_type is created in forum_002 (sorts earlier).
  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config)
    SELECT id,
           'discourse_forum',
           'off-chain',
           ${sql.lit(JSON.stringify({ host: 'research.lido.fi', categories: ['proposals'] }))}::jsonb
    FROM dao
    WHERE slug = 'lido'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Delete all Lido dao_source rows owned by this migration BEFORE the dao + source_type they
  // reference. Lido's `snapshot` dao_source is removed by snapshot_002_seed (rolls back earlier),
  // so by here the only remaining Lido dao_sources are the three created above.
  await sql`
    DELETE FROM dao_source
    WHERE dao_id = (SELECT id FROM dao WHERE slug = 'lido')
      AND source_type IN ('aragon_voting', 'aragon_voting_reconcile', 'discourse_forum')
  `.execute(db);

  await sql`DELETE FROM dao WHERE slug = 'lido'`.execute(db);

  await sql`DELETE FROM source_type WHERE value = 'aragon_voting_reconcile'`.execute(db);
}
