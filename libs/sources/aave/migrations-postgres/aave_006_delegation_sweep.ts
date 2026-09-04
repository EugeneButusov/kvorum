import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO source_type (value)
    VALUES ('aave_token_delegation_sweep')
    ON CONFLICT (value) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT dao_id,
           'aave_token_delegation_sweep',
           chain_id,
           source_config,
           active_from_block
    FROM dao_source
    WHERE source_type = 'aave_token'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM dao_source
    WHERE source_type = 'aave_token_delegation_sweep'
  `.execute(db);

  await sql`DELETE FROM source_type WHERE value = 'aave_token_delegation_sweep'`.execute(db);
}
