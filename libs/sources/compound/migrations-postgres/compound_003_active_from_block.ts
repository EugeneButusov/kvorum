import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// GovernorBravoDelegator deployment block on Ethereum mainnet (2021-03-26).
// Verified via Etherscan tx 0x2fdbaee2ac15cfbe04ddb020f84f072fa353e5703a84a422d6ca3cf734dd1855.
// Using the contract-creation block (not the first-event block) for conservative range coverage.
export const GOVERNOR_BRAVO_DEPLOY_BLOCK = 12006099;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE dao_source
    SET active_from_block = ${sql.lit(GOVERNOR_BRAVO_DEPLOY_BLOCK)}
    WHERE source_type = 'compound_governor'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE dao_source
    SET active_from_block = NULL
    WHERE source_type = 'compound_governor'
  `.execute(db);
}
