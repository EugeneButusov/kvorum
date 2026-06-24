import { Interface } from 'ethers';

// Read-only getters for the Dual Governance reconciler (AB4) and verification.
// Vendored from lidofinance/dual-governance @ ba9dfc9, verified live on 2026-06-24.
//
// State reconciliation is LAZY: `getPersistedState()` returns the last *stored* state, while
// `getEffectiveState()` computes the state the machine *would* be in if `activateNextState()` were
// called now. They diverge whenever a time-based transition is pending but unobserved on-chain.
// The reconciler must read `getEffectiveState()` / `getStateDetails()` — `getPersistedState()` alone
// misses event-silent transitions. There is NO `getState()`.

/** On-chain `State` enum (DualGovernanceStateMachine.sol), by ordinal. */
export const DG_STATE_BY_ORDINAL = [
  'NotInitialized', // 0 — pre-init only; never a live operating state. NO mapping in the PG enum.
  'Normal', // 1
  'VetoSignalling', // 2
  'VetoSignallingDeactivation', // 3
  'VetoCooldown', // 4
  'RageQuit', // 5
] as const;

export type DgStateName = (typeof DG_STATE_BY_ORDINAL)[number];

export function dgStateForOrdinal(ordinal: number): DgStateName {
  const name = DG_STATE_BY_ORDINAL[ordinal];
  if (name === undefined) {
    throw new Error(`unknown DualGovernance State ordinal: ${ordinal}`);
  }
  return name;
}

/** Decoded shape of `getStateDetails()` (IDualGovernance.StateDetails). */
export interface DgStateDetails {
  effectiveState: DgStateName;
  persistedState: DgStateName;
  /** unix seconds */
  persistedStateEnteredAt: number;
  vetoSignallingActivatedAt: number;
  vetoSignallingReactivationTime: number;
  normalOrVetoCooldownExitedAt: number;
  rageQuitRound: bigint;
  /** seconds */
  vetoSignallingDuration: bigint;
}

export const DUAL_GOVERNANCE_GETTERS_INTERFACE = new Interface([
  'function getPersistedState() view returns (uint8 persistedState)',
  'function getEffectiveState() view returns (uint8 effectiveState)',
  'function getStateDetails() view returns (tuple(uint8 effectiveState, uint8 persistedState, uint40 persistedStateEnteredAt, uint40 vetoSignallingActivatedAt, uint40 vetoSignallingReactivationTime, uint40 normalOrVetoCooldownExitedAt, uint256 rageQuitRound, uint32 vetoSignallingDuration) stateDetails)',
  'function getVetoSignallingEscrow() view returns (address)',
  'function getRageQuitEscrow() view returns (address)',
  'function getProposalsCanceller() view returns (address)',
  'function getResealManager() view returns (address)',
  'function getConfigProvider() view returns (address)',
  'function isProposer(address proposerAccount) view returns (bool)',
  'function isExecutor(address executor) view returns (bool)',
]);

export const TIMELOCK_GETTERS_INTERFACE = new Interface([
  // `getGovernance()` is the "is this DG the active governance?" check — must equal the pinned DG.
  'function getGovernance() view returns (address)',
  'function getAdminExecutor() view returns (address)',
  'function getProposalsCount() view returns (uint256 count)',
  'function getProposalDetails(uint256 proposalId) view returns (tuple(uint256 id, uint8 status, address executor, uint40 submittedAt, uint40 scheduledAt) proposalDetails)',
  'function isEmergencyModeActive() view returns (bool)',
]);

/** Timelock proposal `Status` enum (ExecutableProposals.sol), by ordinal. */
export const TIMELOCK_PROPOSAL_STATUS_BY_ORDINAL = [
  'NotExist', // 0
  'Submitted', // 1
  'Scheduled', // 2
  'Executed', // 3
  'Cancelled', // 4
] as const;
