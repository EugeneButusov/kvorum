import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Lido Dual Governance dao_source (Epic AB / AB1, #328). One `dual_governance` source watches the
// DualGovernance contract (state machine + governance-layer proposal/proposer events) and the
// EmergencyProtectedTimelock (proposal lifecycle). SourceResolver registers both addresses to this
// single source. Addresses + activation block were pinned by AB0 — see
// libs/sources/lido/src/dual-governance/{addresses.ts,VERIFICATION.md}.
//
// The legacy DualGovernance (0xcdF49b…, superseded 2025-08-08) is intentionally excluded: its event
// ABI is unverified, and the Timelock (shared across both DG eras) already carries all proposal
// history from its genesis block. Legacy-DG state history is a deferred follow-up.
//
// Ordering: `dual_governance` source_type is created in lido_002 and the `lido` dao row in lido_004,
// both of which sort before this file, so the FK references resolve.
const DUAL_GOVERNANCE_ADDRESS = '0xC1db28B3301331277e307FDCfF8DE28242A4486E';
const TIMELOCK_ADDRESS = '0xCE0425301C85c5Ea2A0873A2dEe44d78E02D2316';
const ACTIVE_FROM_BLOCK = 22537921; // Timelock genesis (2025-05-22) — earliest event of interest.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT id,
           'dual_governance',
           '0x1',
           ${sql.lit(
             JSON.stringify({
               dual_governance_address: DUAL_GOVERNANCE_ADDRESS,
               timelock_address: TIMELOCK_ADDRESS,
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
      AND source_type = 'dual_governance'
      AND chain_id = '0x1'
  `.execute(db);
}
