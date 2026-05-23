export { ERC20_ABI, OZ_ACCESS_CONTROL_ABI, OZ_GOVERNOR_ABI } from './abi-library/index';
export type { AbiEntry, LoadedAbiLibrary } from './calldata/abi-library/index';

export { CalldataDecoder } from './calldata/decoder';
export type { DecodeInput } from './calldata/decoder';
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
import type { VotingPowerStrategy } from '@libs/domain';
import type { BackfillRuntime } from './backfill/types';

/** Nest injection token for the multi-provider array of registered source plugins. */
export const SOURCE_PLUGINS = 'SOURCE_PLUGINS';
/** Nest injection token for flattened source ingesters consumed by orchestrator runtime. */
export const SOURCE_INGESTERS = 'SOURCE_INGESTERS';
/** Nest injection token for source-registered voting-power snapshot strategies by source_type. */
export const SOURCE_SNAPSHOT_STRATEGIES = 'SOURCE_SNAPSHOT_STRATEGIES';

export type SourceSnapshotStrategies = Map<string, VotingPowerStrategy>;

export interface SourceIngester<TConfig = unknown> {
  readonly sourceType: SourceType;
  /** Orchestrator skips any dao_source whose chain is not in this list. */
  readonly supportedChainIds: readonly string[];
  parseConfig(raw: unknown): TConfig;
  buildIngestSpec(ctx: SourceContext, cfg: TConfig): IngestSpec;
  buildBackfillRuntime(ctx: SourceContext, cfg: TConfig): BackfillRuntime;
}

export interface ProjectionDeriver {
  readonly kind: 'projection';
  readonly sourceTypes: readonly string[];
  readonly eventTypes: readonly string[];
  applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void>;
}

export interface ActorAddressPayloadRow {
  chain_id: string;
  tx_hash: string;
  log_index: number;
  block_hash: string;
  event_type: string;
  payload: string;
}

export interface ActorAddressCandidate {
  address: string;
  role?: string;
}

export interface ActorAddressDeriver {
  readonly kind: 'actor-address';
  readonly sourceTypes: readonly string[];
  readonly eventTypes: readonly string[];
  fetchPayloads(rows: readonly ArchiveDerivationRow[]): Promise<readonly ActorAddressPayloadRow[]>;
  extractAddresses(eventType: string, payload: string): readonly ActorAddressCandidate[];
}

export type SourceDeriver = ProjectionDeriver | ActorAddressDeriver;

export interface SourcePlugin {
  readonly name: string;
  readonly ingesters: readonly SourceIngester[];
  readonly derivers: readonly SourceDeriver[];
}

export type IngestSpec =
  | { kind: 'evm-event-poller'; filter: LogFilter; listener: EventsListener<LogEvent> }
  | { kind: 'evm-block-head-poller'; listener: HeadListener };

export interface SourceContext {
  daoSourceId: string;
  sourceType: SourceType;
  chainId: string;
  sourceLabel: SourceType;
}

export { DERIVATION_APPLIERS, ACTOR_SWEEP_ADAPTERS } from './derivation';
export type {
  DerivationProjectionApplier,
  ActorSweepPayloadRow,
  ActorSweepAddressCandidate,
  ActorSweepAdapter,
} from './derivation';

// Re-export the analytical mirror CH table types so @sources/core is the
// canonical import point. The `declare module '@libs/db'` side-effect in
// ./persistence/schema activates whenever @sources/core (or any module
// that transitively imports it) is compiled.
export type {
  VoteEventsAnalytics,
  VoteEventsAnalyticsTable,
  NewVoteEventsAnalytics,
  DelegationFlowAnalytics,
  DelegationFlowAnalyticsTable,
  NewDelegationFlowAnalytics,
} from './persistence/schema';
