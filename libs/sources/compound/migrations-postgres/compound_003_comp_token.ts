import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { COMP_TOKEN_ADDRESS, COMP_TOKEN_DEPLOY_BLOCK } from '../src/comp-token/constants';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO source_type (value)
    VALUES ('compound_comp_token')
    ON CONFLICT (value) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, source_config, active_from_block)
    SELECT id,
           'compound_comp_token',
           jsonb_build_object('token_address', ${sql.lit(COMP_TOKEN_ADDRESS)}),
           ${sql.lit(COMP_TOKEN_DEPLOY_BLOCK)}
    FROM dao
    WHERE slug = 'compound'
    ON CONFLICT (dao_id, source_type) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM dao_source
    WHERE source_type = 'compound_comp_token'
      AND dao_id = (SELECT id FROM dao WHERE slug = 'compound')
  `.execute(db);

  await sql`DELETE FROM source_type WHERE value = 'compound_comp_token'`.execute(db);
}
