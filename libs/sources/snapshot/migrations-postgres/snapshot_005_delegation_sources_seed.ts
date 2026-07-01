import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import {
  DELEGATE_REGISTRY_ADDRESS,
  DELEGATE_REGISTRY_DEPLOY_BLOCK,
  SPLIT_DELEGATION_ADDRESS,
  SPLIT_DELEGATION_DEPLOY_BLOCK,
} from '../src/delegation/constants';

// The Snapshot delegation registries are ecosystem-global single contracts (one per system) on
// mainnet, NOT per-DAO sources. Each gets ONE dao_source: the live consumer routes a contract
// address to a single dao_source (SourceResolver keys on (chain_id, address)), and the deriver
// recovers the real dao from the event's decoded space. The dao_source.dao_id below is therefore
// only the ingester trigger-owner (lido); see ADR-0075. active_from_block is the contract deploy
// block (operator-verified at backfill registration; live polling reads from tip).
const SOURCES = [
  {
    sourceType: 'snapshot_delegate_registry',
    address: DELEGATE_REGISTRY_ADDRESS,
    fromBlock: DELEGATE_REGISTRY_DEPLOY_BLOCK,
  },
  {
    sourceType: 'snapshot_split_delegation',
    address: SPLIT_DELEGATION_ADDRESS,
    fromBlock: SPLIT_DELEGATION_DEPLOY_BLOCK,
  },
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const { sourceType, address, fromBlock } of SOURCES) {
    // sql.lit inlines these trusted constants: bare bound params are type-ambiguous inside
    // jsonb_build_object and SELECT-constant positions (mirrors aave_005_token).
    await sql`INSERT INTO source_type (value) VALUES (${sql.lit(sourceType)}) ON CONFLICT DO NOTHING`.execute(
      db,
    );

    await sql`
      INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
      SELECT id,
             ${sql.lit(sourceType)},
             '0x1',
             jsonb_build_object('registry_address', ${sql.lit(address)}),
             ${sql.lit(fromBlock)}
      FROM dao
      WHERE slug = 'lido'
      ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const { sourceType } of SOURCES) {
    await sql`DELETE FROM dao_source WHERE source_type = ${sql.lit(sourceType)}`.execute(db);
    await sql`DELETE FROM source_type WHERE value = ${sql.lit(sourceType)}`.execute(db);
  }
}
