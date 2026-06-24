// Pinned Lido Dual Governance mainnet addresses + activation blocks.
// Source: lidofinance/dual-governance @ ba9dfc9 deploy-artifacts/deploy-artifact-mainnet.toml,
// cross-verified against live mainnet bytecode + getters on 2026-06-24 (block 25387417).
// See ./VERIFICATION.md for bytecode hashes and the verification record.
//
// DEPLOYMENT TIMELINE (load-bearing for `active_from_block` — established by AB0):
//   2025-05-22 (block 22537920/22537921/22537924): AdminExecutor, Timelock, and the LEGACY
//     DualGovernance (0xcdF49b…) were deployed; DG launched 2025-06-30.
//   2025-08-08 (block 23095715): post-Immunefi redeploy — the CURRENT DualGovernance (0xC1db28B3…),
//     a new Escrow master copy, and the first signalling-escrow clone. The Timelock is UNCHANGED;
//     its `governance` was re-pointed from the legacy DG to the current DG.
//
// Consequence for AB1/AB2: complete DAO-wide state history (ADR-024) requires indexing BOTH DG
// addresses — `DualGovernanceStateChanged` from the legacy DG (22537924…23095715) AND the current DG
// (23095715…). The Timelock proposal stream (all 11 proposals to date) is a single source from
// 22537921 onward.

export const DUAL_GOVERNANCE_MAINNET = {
  /** Current, active DualGovernance (timelock.getGovernance() == this). From block 23095715. */
  dualGovernance: '0xC1db28B3301331277e307FDCfF8DE28242A4486E',
  /** Legacy DualGovernance, superseded 2025-08-08. Code persists; state frozen. Index for history. */
  dualGovernanceLegacy: '0xcdF49b058D606AD34c5789FD8c3BF8B3E54bA2db',
  /** EmergencyProtectedTimelock — shared across both DG eras. From block 22537921. */
  timelock: '0xCE0425301C85c5Ea2A0873A2dEe44d78E02D2316',
  /** AdminExecutor — the executor DG submits calls through (AB3 correlation anchor). */
  adminExecutor: '0x23E0B465633FF5178808F4A75186E2F2F9537021',
  /** Escrow master copy; signalling/rage-quit instances are EIP-1167 clones of this. */
  escrowMasterCopy: '0xd6A67636c05BeB5B4a5c90D408b03A63c4e39426',
  /** ResealManager — emergency mechanism (KNOWN-003: detect + document, do not model). */
  resealManager: '0x7914b5a1539b97Bd0bbd155757F25FD79A522d24',
  /** Immutable config provider (veto/rage-quit durations + rage-quit support thresholds). */
  configProvider: '0xa1692Af6FDfdD1030E4E9c4Bc429986FA64CB5EF',
} as const;

/** Earliest block of interest (Timelock genesis). DG state events start at the legacy-DG block below. */
export const DUAL_GOVERNANCE_ACTIVE_FROM_BLOCK = 22537921;
export const DUAL_GOVERNANCE_LEGACY_DG_FROM_BLOCK = 22537924;
export const DUAL_GOVERNANCE_CURRENT_DG_FROM_BLOCK = 23095715;

// On-chain `State` enum (incl. NotInitialized=0) → existing PG `dual_governance_state` enum.
// FINDING for AB1: the PG enum (lido_002_dual_governance.ts) OMITS `NotInitialized`, so on-chain
// ordinals are offset by 1 from the PG enum. Map by NAME, never by positional ordinal. `NotInitialized`
// has no PG value — either add it in an AB1 migration or assert it never appears in a live transition.
export const DG_ONCHAIN_STATE_TO_PG = {
  Normal: 'normal',
  VetoSignalling: 'veto_signaling',
  VetoSignallingDeactivation: 'veto_signaling_deactivation',
  VetoCooldown: 'veto_cooldown',
  RageQuit: 'rage_quit',
} as const;
