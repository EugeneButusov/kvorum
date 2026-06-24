import { Interface } from 'ethers';

// Vendored from lidofinance/dual-governance @ ba9dfc9 (2026-03-04), verified against
// the deployed mainnet bytecode on 2026-06-24 (block 25387417). See VERIFICATION.md.
//
// Two event-emitting layers (AB1 decodes both):
//   1. DualGovernance       — state-machine + proposer-registry + signalling-escrow lifecycle.
//   2. EmergencyProtectedTimelock — proposal lifecycle (submit/schedule/execute/bulk-cancel).
//
// Custom Solidity value types resolve to their ABI underlying for topic computation:
//   State    -> uint8   (enum)
//   Timestamp-> uint40   Duration -> uint32
// The DualGovernanceStateChanged `Context` tuple field order is load-bearing for topic0
// and is reproduced exactly from DualGovernanceStateMachine.sol::Context.

const DUAL_GOVERNANCE_EVENTS = [
  // State machine — `DualGovernanceStateChanged` is the canonical transition event AB2 derives
  // `dual_governance_state_history` from (ADR-024). NOTE: lazy transitions mean it only fires when
  // someone calls `activateNextState()`; event-silent transitions are the norm (reconciler-driven).
  'event DualGovernanceStateChanged(uint8 indexed from, uint8 indexed to, tuple(uint8 state, uint40 enteredAt, uint40 vetoSignallingActivatedAt, address signallingEscrow, uint8 rageQuitRound, uint40 vetoSignallingReactivationTime, uint40 normalOrVetoCooldownExitedAt, address rageQuitEscrow, address configProvider) context)',
  // Master-copy + clones: a new signalling Escrow clone is deployed on each veto-signalling cycle.
  // AB1 indexes this on the master copy to discover clone instances (do NOT hardcode a clone addr).
  'event NewSignallingEscrowDeployed(address indexed escrow)',
  'event ConfigProviderSet(address newConfigProvider)',
  // Proposer registry (executor mapping is AB3's N:M correlation anchor).
  'event ProposerRegistered(address indexed proposerAccount, address indexed executor)',
  'event ProposerExecutorSet(address indexed proposerAccount, address indexed executor)',
  'event ProposerUnregistered(address indexed proposerAccount, address indexed executor)',
] as const;

const TIMELOCK_EVENTS = [
  // Proposal lifecycle (ExecutableProposals library). `ProposalsCancelledTill` is the BULK cancel
  // (cancels every non-executed proposal with id <= proposalId) — verified, not assumed.
  'event ProposalSubmitted(uint256 indexed id, address indexed executor, tuple(address target, uint96 value, bytes payload)[] calls)',
  'event ProposalScheduled(uint256 indexed id)',
  'event ProposalExecuted(uint256 indexed id)',
  'event ProposalsCancelledTill(uint256 proposalId)',
  // Emergency mechanisms — KNOWN-003: detect + document, do not model in M4.
  'event EmergencyModeActivated()',
  'event EmergencyModeDeactivated()',
] as const;

export const DUAL_GOVERNANCE_INTERFACE = new Interface([...DUAL_GOVERNANCE_EVENTS]);
export const TIMELOCK_INTERFACE = new Interface([...TIMELOCK_EVENTS]);

function topic(iface: Interface, name: string): string {
  return iface.getEvent(name)!.topicHash.toLowerCase();
}

export const DUAL_GOVERNANCE_TOPICS = {
  DualGovernanceStateChanged: topic(DUAL_GOVERNANCE_INTERFACE, 'DualGovernanceStateChanged'),
  NewSignallingEscrowDeployed: topic(DUAL_GOVERNANCE_INTERFACE, 'NewSignallingEscrowDeployed'),
  ConfigProviderSet: topic(DUAL_GOVERNANCE_INTERFACE, 'ConfigProviderSet'),
  ProposerRegistered: topic(DUAL_GOVERNANCE_INTERFACE, 'ProposerRegistered'),
  ProposerExecutorSet: topic(DUAL_GOVERNANCE_INTERFACE, 'ProposerExecutorSet'),
  ProposerUnregistered: topic(DUAL_GOVERNANCE_INTERFACE, 'ProposerUnregistered'),
} as const;

export const TIMELOCK_TOPICS = {
  ProposalSubmitted: topic(TIMELOCK_INTERFACE, 'ProposalSubmitted'),
  ProposalScheduled: topic(TIMELOCK_INTERFACE, 'ProposalScheduled'),
  ProposalExecuted: topic(TIMELOCK_INTERFACE, 'ProposalExecuted'),
  ProposalsCancelledTill: topic(TIMELOCK_INTERFACE, 'ProposalsCancelledTill'),
  EmergencyModeActivated: topic(TIMELOCK_INTERFACE, 'EmergencyModeActivated'),
  EmergencyModeDeactivated: topic(TIMELOCK_INTERFACE, 'EmergencyModeDeactivated'),
} as const;

export type DualGovernanceTopics = typeof DUAL_GOVERNANCE_TOPICS;
export type TimelockTopics = typeof TIMELOCK_TOPICS;
