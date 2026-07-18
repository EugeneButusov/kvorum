import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// GovernorAlpha was left without a reconcile source when the seed migration added them for Bravo
// and OZ. Alpha is superseded and will never receive another proposal, but proposals that ended in
// defeat emit no event — defeat is the absence of enough votes at endBlock — so nothing ever moved
// them off `pending`. This clones the reconcile source the same way the seed does for its siblings.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO source_type (value)
    VALUES ('compound_governor_alpha_reconcile')
    ON CONFLICT (value) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT dao_id, 'compound_governor_alpha_reconcile', chain_id, source_config, active_from_block
    FROM dao_source
    WHERE source_type = 'compound_governor_alpha'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM dao_source WHERE source_type = 'compound_governor_alpha_reconcile'
  `.execute(db);

  await sql`
    DELETE FROM source_type WHERE value = 'compound_governor_alpha_reconcile'
  `.execute(db);
}
