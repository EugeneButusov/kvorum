import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO source_type (value)
    VALUES ('compound_governor_bravo_reconcile'), ('compound_governor_oz_reconcile')
    ON CONFLICT (value) DO NOTHING
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
    WHERE source_type IN ('compound_governor_bravo_reconcile', 'compound_governor_oz_reconcile')
  `.execute(db);

  await sql`
    DELETE FROM source_type
    WHERE value IN ('compound_governor_bravo_reconcile', 'compound_governor_oz_reconcile')
  `.execute(db);
}
