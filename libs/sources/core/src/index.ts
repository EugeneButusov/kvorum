export { BaseArchiveWriter } from './base-archive-writer';
export { makeIngesterListener } from './ingester-listener';
export { DecodeError } from './decode-error';
export type { DecodeErrorReason } from './decode-error';
export type { ArchiveWriteContext, ArchiveWriteOutcome } from './archive-writer-types';
export type { IngesterListenerOptions } from './listener-options';
export { serializeError } from './serialize-error';

export {
  ERC20_ABI,
  OZ_ACCESS_CONTROL_ABI,
  OZ_GOVERNOR_ABI,
  loadSharedAbiLibrary,
} from './abi-library/index';
export type { AbiEntry, LoadedAbiLibrary } from './calldata/abi-library/index';
export { ReconcileDriver, isTransientRpcError } from './reconcile/reconcile-driver';
export type {
  BaseStaleReconciliationRow,
  ReconcileBound,
  ReconcileDriverConfig,
  ReconcileDriverMetrics,
  ReconcileOutcome,
  ReconcilePerChainBound,
  ReconcileRpcClient,
  ReconcilableProposalRepository,
  StateReconciler,
} from './reconcile/types';

export { CalldataDecoder } from './calldata/decoder';
export type { DecodeInput } from './calldata/decoder';

export type {
  ChoiceBounds,
  ProposalExtension,
  ProposalPayloadView,
  ProposalVotingView,
  SourceReadExtension,
} from '@libs/domain';
export { EtherscanClient } from './calldata/etherscan-client';
export type { EtherscanClientConfig } from './calldata/etherscan-client';
export { readCalldataDecoderConfig } from './calldata/config';
export type { CalldataDecoderConfig, EtherscanConfig } from './calldata/config';
export type {
  DecodeResult,
  DecodeSource,
  DecoderDependencies,
  EtherscanClientLike,
  HeuristicResult,
} from './calldata/types';
export type { CalldataProtocolSupport } from './calldata/protocol';
export { ChainNotReadyError } from './calldata/types';

export { BackfillDriver } from './backfill/backfill-driver';
export type { BackfillDriverDeps } from './backfill/backfill-driver';
export type {
  BackfillMode,
  BackfillRunInput,
  BackfillOutcome,
  BackfillRuntime,
} from './backfill/types';
export { computeGap } from './backfill/gap-detector';
export type { GapComputationResult, GapRangeInput } from './backfill/gap-detector';
export { runBootCatchUp, processBootCatchUp } from './backfill/boot-catch-up';
export type { BootCatchUpInput, BootCatchUpResult } from './backfill/boot-catch-up';
export { BootCatchUpShutdownError } from './backfill/errors/boot-catch-up-shutdown.error';
export { BackfillAlreadyStartedError } from './backfill/errors/backfill-already-started.error';
export { BackfillNotResumableError } from './backfill/errors/backfill-not-resumable.error';
export { DaoSourceNotFoundError } from './backfill/errors/dao-source-not-found.error';

import type { HeadListener, LogFilter, EventsListener, LogEvent } from '@libs/chain';
import type { SourceType } from '@libs/db';
import type { ArchiveDerivationRow } from '@libs/db';
import type { ArchiveEventType, SourceReadExtension } from '@libs/domain';
import type { BackfillRuntime } from './backfill/types';
import type { PollListener } from './poll/types';
import type { RawLogJob } from './producer/archive-producer';
import type { SourceContext } from './source-context';

export type { SourceContext } from './source-context';
export type {
  PollItem,
  PollResult,
  PollPollContext,
  PollListener,
  QueueProducerPort,
} from './poll/types';

/** Nest injection token for the multi-provider array of registered source plugins. */
export const SOURCE_PLUGINS = 'SOURCE_PLUGINS';
/** Nest injection token for flattened source ingesters consumed by orchestrator runtime. */
export const SOURCE_INGESTERS = 'SOURCE_INGESTERS';

export interface SourceIngester<TConfig = unknown> {
  readonly sourceType: SourceType;
  /** Orchestrator skips any dao_source whose chain is not in this list. */
  readonly supportedChainIds: readonly string[];
  parseConfig(raw: unknown): TConfig;
  buildIngestSpec(ctx: SourceContext, cfg: TConfig): IngestSpec;
  buildBackfillRuntime(ctx: SourceContext, cfg: TConfig): BackfillRuntime;
  /** Returns the consumer-path archive function for this source (optional). */
  buildArchiveConsumer?(): ArchiveConsumeFn;
  /** Returns the per-source CH writer for off-chain rows (optional). The generic off-chain
   *  consumer owns the PG watermark + mutable-latest; this writes only the CH archive. */
  buildOffChainArchiveWriter?(): OffChainArchiveWriteFn;
}

export interface ProjectionDeriver {
  readonly kind: 'projection';
  readonly sourceTypes: readonly string[];
  readonly eventTypes: readonly ArchiveEventType[];
  applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void>;
}

export interface ActorAddressPayloadRow {
  chain_id: string;
  tx_hash: string;
  log_index: number;
  block_hash: string;
  event_type: ArchiveEventType;
  payload: string;
}

export interface ActorAddressCandidate {
  address: string;
  role?: string;
}

export interface ActorAddressDeriver {
  readonly kind: 'actor-address';
  readonly sourceTypes: readonly string[];
  readonly eventTypes: readonly ArchiveEventType[];
  fetchPayloads(rows: readonly ArchiveDerivationRow[]): Promise<readonly ActorAddressPayloadRow[]>;
  extractAddresses(eventType: ArchiveEventType, payload: string): readonly ActorAddressCandidate[];
}

export type SourceDeriver = ProjectionDeriver | ActorAddressDeriver;

export interface SourcePlugin {
  readonly name: string;
  readonly ingesters: readonly SourceIngester[];
  readonly derivers: readonly SourceDeriver[];
  readonly readExtension: SourceReadExtension;
}

export type IngestSpec =
  // listener is optional: the driver injects the generic archive producer for the live path.
  // Backfill supplies its own listener via buildBackfillRuntime().listenerFactory().
  | { kind: 'evm-event-poller'; filter: LogFilter; listener?: EventsListener<LogEvent> }
  | { kind: 'evm-block-head-poller'; listener: HeadListener }
  | { kind: 'poll'; listener: PollListener };

export { makeArchiveProducer } from './producer/archive-producer';
export type { RawLogJob, ArchiveProducerDeps } from './producer/archive-producer';

/** Write context passed to the consumer's archive-consume function. */
export interface ArchiveConsumeContext {
  daoSourceId: string;
  sourceType: string;
  chainId: string;
  sourceLabel: string;
}

/** Consumer-path archive function: decode RawLogJob → CH-first write. Throws on failure. */
export type ArchiveConsumeFn = (ctx: ArchiveConsumeContext, raw: RawLogJob) => Promise<void>;

/** One off-chain item handed to the per-source CH writer. `version` is assigned by the
 *  generic consumer (PG-monotonic) and is the CH ReplacingMergeTree(version) sort key. */
export interface OffChainArchiveItem {
  externalId: string;
  contentHash: string;
  ordinal: string | null;
  version: number;
  payload: unknown;
}

/** Per-source off-chain CH writer: idempotent insert keyed on (external_id, version).
 *  PG watermark + mutable-latest decision are owned by the generic consumer. Throws on failure. */
export type OffChainArchiveWriteFn = (
  ctx: ArchiveConsumeContext,
  item: OffChainArchiveItem,
) => Promise<void>;
export { DERIVATION_APPLIERS, ACTOR_SWEEP_ADAPTERS } from './derivation';
export type {
  DerivationProjectionApplier,
  ActorSweepPayloadRow,
  ActorSweepAddressCandidate,
  ActorSweepAdapter,
} from './derivation';
export { VoteBlockTimestampFetcher } from './vote/vote-block-timestamp';
export type { VoteBlockRef } from './vote/vote-block-timestamp';
export { ProjectionError } from './vote/vote-errors';
export type {
  VoteProjectionDlqReason,
  VoteProjectionErrorReason,
  VoteProjectionHoldReason,
} from './vote/vote-errors';
export { buildVoteRows, isNewerVote } from './vote/vote-rows';
export { singleChoiceBreakdown } from './vote/breakdown';

// Re-export CH source-of-truth table row types so @sources/core remains the
// canonical import point. The `declare module '@libs/db'` side-effect in
// ./persistence/schema activates whenever @sources/core (or any module that
// transitively imports it) is compiled.
export type {
  VoteEventsProjectionRow,
  NewVoteEventsProjectionRow,
  DelegationFlowProjectionRow,
  NewDelegationFlowProjectionRow,
} from './persistence/schema';
