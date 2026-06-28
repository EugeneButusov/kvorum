import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Lido Easy Track dao_source. One `easy_track` source watches the EasyTrack contract for the motion
// lifecycle + settings events. Addresses + activation block are pinned in
// libs/sources/lido/src/easy-track/{addresses.ts,VERIFICATION.md} (deployed bytecode is non-proxy /
// immutable, so the event signatures are stable across the contract's whole history).
//
// The EVMScriptExecutor is carried in source_config for the later EVMScript-action decoder; it emits
// no motion events and is not part of the watched address set.
//
// Ordering: the `easy_track` source_type is created in lido_003 and the `lido` dao row in lido_004,
// both of which sort before this file, so the FK references resolve.
const EASY_TRACK_ADDRESS = '0xF0211b7660680B49De1A7E9f25C65660F0a13Fea';
const EVM_SCRIPT_EXECUTOR_ADDRESS = '0xFE5986E06210aC1eCC1aDCafc0cc7f8D63B3F977';
const ACTIVE_FROM_BLOCK = 13676729; // EasyTrack contract-creation block (2021-11-24).

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT id,
           'easy_track',
           '0x1',
           ${sql.lit(
             JSON.stringify({
               easy_track_address: EASY_TRACK_ADDRESS,
               evm_script_executor_address: EVM_SCRIPT_EXECUTOR_ADDRESS,
             }),
           )}::jsonb,
           ${sql.lit(ACTIVE_FROM_BLOCK)}
    FROM dao
    WHERE slug = 'lido'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM dao_source
    WHERE dao_id = (SELECT id FROM dao WHERE slug = 'lido')
      AND source_type = 'easy_track'
      AND chain_id = '0x1'
  `.execute(db);
}
