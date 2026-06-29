export type {
  AragonProposalMetadata,
  AragonProposalMetadataTable,
  AragonProposalMetadataUpdate,
  NewAragonProposalMetadata,
  ArchiveEventAragonVoting,
  ArchiveEventAragonVotingTable,
  NewArchiveEventAragonVoting,
  ArchiveEventDualGovernance,
  ArchiveEventDualGovernanceTable,
  NewArchiveEventDualGovernance,
  ArchiveEventEasyTrack,
  ArchiveEventEasyTrackTable,
  NewArchiveEventEasyTrack,
  DualGovernanceState,
  DualGovernanceStateHistory,
  DualGovernanceStateHistoryTable,
  DualGovernanceStateHistoryUpdate,
  NewDualGovernanceStateHistory,
  DualGovernanceProposal,
  DualGovernanceProposalTable,
  DualGovernanceProposalUpdate,
  DualGovernanceProposalOrigin,
  DualGovernanceProposalStatus,
  NewDualGovernanceProposal,
  DualGovernanceReconcileState,
  DualGovernanceReconcileStateTable,
  DualGovernanceReconcileStateUpdate,
  NewDualGovernanceReconcileState,
  EasyTrackMotionMeta,
  EasyTrackMotionMetaTable,
  EasyTrackMotionMetaUpdate,
  EasyTrackMotionState,
  NewEasyTrackMotionMeta,
} from './persistence/schema';

// EVMScript decoder
export { toProposalActions } from './calldata/evmscript-actions';
export { createForwarderRegistry, FORWARD_SELECTOR, EXECUTE_SELECTOR } from './calldata/forwarders';
export type { ForwarderRegistry, ForwarderEntry } from './calldata/forwarders';
export { decodeEvmScript, EvmScriptDecodeError } from '@sources/core';
export type { EvmScriptCall, EvmScriptDecodeErrorReason } from '@sources/core';

// Aragon Voting (Lido two-phase fork)
export { ARAGON_VOTING_INTERFACE, ARAGON_VOTING_TOPICS } from './aragon-voting/abi/events';
export type { AragonVotingTopics } from './aragon-voting/abi/events';
export { decodeAragonVotingLog } from './aragon-voting/abi/decoder';
export type { AragonVotingEvent } from './aragon-voting/domain/types';
export { ARAGON_VOTING_EVENT_TYPES } from './aragon-voting/domain/types';
export { AragonVotingEventRepository } from './aragon-voting/persistence/event-repository';
export type {
  AragonVotingEventData,
  AragonVotingEventRepositoryDeps,
} from './aragon-voting/persistence/event-repository.types';
export { LidoAragonVotingArchiveWriter } from './aragon-voting/ingestion/archive-writer';
export type { LidoAragonVotingArchiveWriterDeps } from './aragon-voting/ingestion/archive-writer.types';
export { makeAragonVotingIngesterListener } from './aragon-voting/ingestion/ingester-listener';
export type { AragonVotingIngesterListenerDeps } from './aragon-voting/ingestion/ingester-listener';
export {
  createLidoAragonVotingPlugin,
  LidoAragonVotingConfigSchema,
  SUPPORTED_CHAIN_IDS,
} from './aragon-voting/plugin/plugin';
export type {
  LidoAragonVotingConfig,
  LidoAragonVotingPluginDeps,
} from './aragon-voting/plugin/plugin';
export { makeLidoReadExtension } from './aragon-voting/api/lido-read-extension';

// Aragon Voting derivation (proposal/vote projection, actor sweep, metadata)
export { LidoAragonVotingActorAddressDeriver } from './aragon-voting/domain/actor-address-deriver';
export type {
  AragonActorAddressSource,
  AragonAddressCandidate,
} from './aragon-voting/domain/actor-address-deriver';
export { AragonVotingArchivePayloadRepository } from './aragon-voting/persistence/archive-payload-repository';
export type { AragonVotingArchivePayloadRow } from './aragon-voting/persistence/archive-payload-repository';
export { AragonProposalRepository } from './aragon-voting/persistence/aragon-proposal-repository';
export type {
  AragonStaleReconciliationRow,
  AragonReconcileStateInput,
} from './aragon-voting/persistence/aragon-proposal-repository';
export { extractAragonTitle } from './aragon-voting/domain/title-extractor';
export {
  projectAragonProposalEvent,
  AragonProposalProjectionError,
} from './aragon-voting/domain/proposal-projector';
export type {
  AragonProposalProjection,
  AragonProposalCreatedProjection,
  AragonStateTransitionProjection,
  AragonConfigNoopProjection,
} from './aragon-voting/domain/proposal-projector';
export { projectAragonVoteCast } from './aragon-voting/domain/vote-projector';
export type { AragonVoteIncoming } from './aragon-voting/domain/vote-projector';
export { AragonProposalProjectionApplier } from './aragon-voting/domain/aragon-proposal-projection-applier';
export type {
  AragonProposalProjectionApplierDeps,
  AragonProposalProjectionMetrics,
} from './aragon-voting/domain/aragon-proposal-projection-applier';
export { AragonVoteProjectionApplier } from './aragon-voting/domain/aragon-vote-projection-applier';
export type {
  AragonVoteProjectionApplierDeps,
  AragonVoteProjectionMetrics,
} from './aragon-voting/domain/aragon-vote-projection-applier';

// Aragon Voting state reconciler + getVote enrichment
export {
  GET_VOTE_INTERFACE,
  AragonGetVoteDecodeError,
  encodeGetVote,
  decodeGetVote,
} from './aragon-voting/abi/get-vote';
export type { AragonGetVoteResult } from './aragon-voting/abi/get-vote';
export { AragonStateReconciler } from './aragon-voting/reconcile/aragon-state-reconciler';
export { createLidoAragonVotingReconcilePlugin } from './aragon-voting/reconcile/aragon-reconcile-plugin';
export type { LidoAragonVotingReconcilePluginDeps } from './aragon-voting/reconcile/aragon-reconcile-plugin';

// Calldata ABI library (proposal_action decode, §3.8)
export { lidoCalldataProtocol } from './calldata/protocol';

// ── Dual Governance ──────────────────────────────────────────────────────────
export {
  DUAL_GOVERNANCE_INTERFACE,
  TIMELOCK_INTERFACE,
  DUAL_GOVERNANCE_TOPICS,
  TIMELOCK_TOPICS,
} from './dual-governance/abi/events';
export type { DualGovernanceTopics, TimelockTopics } from './dual-governance/abi/events';
export { decodeDualGovernanceLog } from './dual-governance/abi/decoder';
export type { DualGovernanceEvent, DualGovernanceEventType } from './dual-governance/domain/types';
export {
  DUAL_GOVERNANCE_MAINNET,
  DUAL_GOVERNANCE_ACTIVE_FROM_BLOCK,
  DG_ONCHAIN_STATE_TO_PG,
} from './dual-governance/addresses';
export { DualGovernanceEventRepository } from './dual-governance/persistence/event-repository';
export type { DualGovernanceEventData } from './dual-governance/persistence/event-repository.types';
export { LidoDualGovernanceArchiveWriter } from './dual-governance/ingestion/archive-writer';
export type { LidoDualGovernanceArchiveWriterDeps } from './dual-governance/ingestion/archive-writer.types';
export { makeDualGovernanceIngesterListener } from './dual-governance/ingestion/ingester-listener';
export type { DualGovernanceIngesterListenerDeps } from './dual-governance/ingestion/ingester-listener';
export {
  createLidoDualGovernancePlugin,
  LidoDualGovernanceConfigSchema,
} from './dual-governance/plugin/plugin';
export type {
  LidoDualGovernanceConfig,
  LidoDualGovernancePluginDeps,
} from './dual-governance/plugin/plugin';

// Dual Governance DAO-wide state-history derivation (ADR-024)
export { DualGovernanceArchivePayloadRepository } from './dual-governance/persistence/archive-payload-repository';
export type { DualGovernanceArchivePayloadRow } from './dual-governance/persistence/archive-payload-repository';
export { DualGovernanceStateHistoryRepository } from './dual-governance/persistence/state-history-repository';
export { LidoDualGovernanceActorAddressDeriver } from './dual-governance/domain/actor-address-deriver';
export { projectDualGovernanceStateChange } from './dual-governance/domain/state-projector';
export type { StateChangeCoords } from './dual-governance/domain/state-projector';
export { DualGovernanceStateProjectionApplier } from './dual-governance/domain/state-projection-applier';
export { DualGovernanceProposalRepository } from './dual-governance/persistence/dg-proposal-repository';
export { AragonEnactmentLookup } from './dual-governance/persistence/aragon-enactment-lookup';
export { DualGovernanceProposalProjectionApplier } from './dual-governance/domain/dg-proposal-projection-applier';
export type {
  DualGovernanceProposalProjectionApplierDeps,
  DualGovernanceProposalProjectionMetrics,
  DualGovernanceProposalOutcome,
  DualGovernanceProposalFailureReason,
} from './dual-governance/domain/dg-proposal-projection-applier';
export {
  computeCallsHash,
  callsToProposalActions,
  ledgerStatusToProposalState,
  buildDirectProposal,
  resolveUnifiedProposalState,
  applyUnifiedProposalState,
} from './dual-governance/domain/proposal-correlator';
export type {
  DirectProposalDraft,
  DirectProposalInput,
  UnifiedProposalStateWriter,
  UnifiedProposalLedgerRow,
} from './dual-governance/domain/proposal-correlator';

// Dual Governance reconcile (ADR-0074 §2) — observational DAO-wide state reconciler.
export { DualGovernanceReconcileRepository } from './dual-governance/persistence/dg-reconcile-repository';
export type { DgStaleReconciliationRow } from './dual-governance/persistence/dg-reconcile-repository';
export { DualGovernanceStateReconciler } from './dual-governance/reconcile/dg-state-reconciler';
export { createLidoDualGovernanceReconcilePlugin } from './dual-governance/reconcile/dg-reconcile-plugin';
export type { LidoDualGovernanceReconcilePluginDeps } from './dual-governance/reconcile/dg-reconcile-plugin';
export type {
  DualGovernanceStateProjectionApplierDeps,
  DualGovernanceStateProjectionMetrics,
} from './dual-governance/domain/state-projection-applier';

// ── Easy Track (Lido optimistic motions) ──────────────────────────────────────
export { EASY_TRACK_INTERFACE, EASY_TRACK_TOPICS } from './easy-track/abi/events';
export type { EasyTrackTopics } from './easy-track/abi/events';
export { decodeEasyTrackLog } from './easy-track/abi/decoder';
export type { EasyTrackEvent, EasyTrackEventType } from './easy-track/domain/types';
export { EASY_TRACK_MAINNET, EASY_TRACK_ACTIVE_FROM_BLOCK } from './easy-track/addresses';
export { EasyTrackEventRepository } from './easy-track/persistence/event-repository';
export type {
  EasyTrackEventData,
  EasyTrackEventRepositoryDeps,
} from './easy-track/persistence/event-repository.types';
export { EasyTrackArchivePayloadRepository } from './easy-track/persistence/archive-payload-repository';
export type { EasyTrackArchivePayloadRow } from './easy-track/persistence/archive-payload-repository';
export { LidoEasyTrackArchiveWriter } from './easy-track/ingestion/archive-writer';
export type { LidoEasyTrackArchiveWriterDeps } from './easy-track/ingestion/archive-writer.types';
export { makeEasyTrackIngesterListener } from './easy-track/ingestion/ingester-listener';
export type { EasyTrackIngesterListenerDeps } from './easy-track/ingestion/ingester-listener';
export { createLidoEasyTrackPlugin, LidoEasyTrackConfigSchema } from './easy-track/plugin/plugin';
export type { LidoEasyTrackConfig, LidoEasyTrackPluginDeps } from './easy-track/plugin/plugin';
// Easy Track motion derivation (ADR-076): motion → unified proposal + easy_track_motion_meta.
export { DEFAULT_MOTION_DURATION_SECONDS } from './easy-track/addresses';
export { LidoEasyTrackActorAddressDeriver } from './easy-track/domain/actor-address-deriver';
export { easyTrackMotionTitle } from './easy-track/domain/title-extractor';
export {
  projectMotionCreated,
  MOTION_TERMINAL_TRANSITIONS,
} from './easy-track/domain/motion-projector';
export { EasyTrackMotionProjectionApplier } from './easy-track/domain/motion-projection-applier';
export type {
  EasyTrackMotionProjectionApplierDeps,
  EasyTrackMotionProjectionMetrics,
} from './easy-track/domain/motion-projection-applier';
export { EasyTrackMotionRepository } from './easy-track/persistence/motion-repository';
// Easy Track reconcile (ADR-076 §reconciler): event-silent optimistic-pass (active → queued).
export {
  EASY_TRACK_GETTERS_INTERFACE,
  encodeGetMotions,
  decodeGetMotions,
} from './easy-track/abi/getters';
export type { EasyTrackMotion } from './easy-track/abi/getters';
export { EasyTrackReconcileRepository } from './easy-track/persistence/reconcile-repository';
export type {
  EasyTrackStaleReconciliationRow,
  EasyTrackReconcileStateInput,
} from './easy-track/persistence/reconcile-repository';
export { EasyTrackStateReconciler } from './easy-track/reconcile/easy-track-state-reconciler';
export { createLidoEasyTrackReconcilePlugin } from './easy-track/reconcile/easy-track-reconcile-plugin';
export type { LidoEasyTrackReconcilePluginDeps } from './easy-track/reconcile/easy-track-reconcile-plugin';
