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

export { makeCutoffClassifier } from './backfill/cutoff-classifier';
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
export { withDaoSourceAdvisoryLock } from './backfill/dao-source-lock';
export {
  runStartupGapFill,
  processStartupGapFill,
  StartupGapFillShutdownError,
} from './backfill/startup-gap-fill';
export type { StartupGapFillInput, StartupGapFillResult } from './backfill/startup-gap-fill';
export { BackfillNotResumableError } from './backfill/errors/backfill-not-resumable.error';

import type { HeadListener, LogFilter, EventsListener, LogEvent } from '@libs/chain';
import type { SourceType } from '@libs/db';
import type { BackfillRuntime } from './backfill/types';

/** Nest injection token for the multi-provider array of registered SourcePlugins. */
export const SOURCE_PLUGINS = 'SOURCE_PLUGINS';

export interface SourcePlugin<TConfig = unknown> {
  readonly sourceType: SourceType;
  /** Orchestrator skips any dao_source whose chain is not in this list. */
  readonly supportedChainIds: readonly string[];
  parseConfig(raw: unknown): TConfig;
  buildIngestSpec(ctx: SourceContext, cfg: TConfig): IngestSpec;
  buildBackfillRuntime(ctx: SourceContext, cfg: TConfig): BackfillRuntime;
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
