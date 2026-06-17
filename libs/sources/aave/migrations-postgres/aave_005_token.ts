import { sql, type Kysely } from 'kysely';
import { AAVE_TOKEN_ADDRESS, AAVE_TOKEN_V3_ACTIVATION_BLOCK } from '../src/aave-token/constants';

// Registers the AAVE governance-token delegation source (mainnet, AaveTokenV3 DelegateChanged).
// Lean cut per ADR-0070: AAVE token only, voting-power delegation only, relationship-only,
// V3-only. active_from_block is the V3 proxy upgrade (~2023-12-26); pre-V3 (V2 ABI) history
// is out of scope.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO source_type (value)
    VALUES ('aave_token')
    ON CONFLICT (value) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT id,
           'aave_token',
           '0x1',
           jsonb_build_object('token_address', ${sql.lit(AAVE_TOKEN_ADDRESS)}),
           ${sql.lit(AAVE_TOKEN_V3_ACTIVATION_BLOCK)}
    FROM dao
    WHERE slug = 'aave'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM dao_source
    WHERE source_type = 'aave_token'
      AND dao_id = (SELECT id FROM dao WHERE slug = 'aave')
  `.execute(db);

  await sql`DELETE FROM source_type WHERE value = 'aave_token'`.execute(db);
}
