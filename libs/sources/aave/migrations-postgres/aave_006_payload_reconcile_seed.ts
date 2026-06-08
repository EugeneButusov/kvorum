import type { Kysely } from 'kysely';
import { sql } from 'kysely';

const RECONCILE_SOURCE_TYPE = 'aave_payloads_controller_reconcile';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO source_type (value)
    VALUES (${RECONCILE_SOURCE_TYPE})
    ON CONFLICT (value) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT dao_id, ${RECONCILE_SOURCE_TYPE}, chain_id, source_config, active_from_block
    FROM dao_source
    WHERE source_type = 'aave_payloads_controller'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM dao_source
    WHERE source_type = ${RECONCILE_SOURCE_TYPE}
  `.execute(db);

  await sql`
    DELETE FROM source_type
    WHERE value = ${RECONCILE_SOURCE_TYPE}
  `.execute(db);
}
