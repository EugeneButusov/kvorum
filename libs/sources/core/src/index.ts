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
export type { BackfillMode, BackfillRunInput, BackfillOutcome } from './backfill/types';
export { BackfillNotResumableError } from './backfill/errors/backfill-not-resumable.error';
export { BackfillAlreadyStartedError } from './backfill/errors/backfill-already-started.error';

import type { LogFilter, EventsListener, LogEvent } from '@libs/chain';
import type { SourceType } from '@libs/db';

/** Nest injection token for the multi-provider array of registered SourcePlugins. */
export const SOURCE_PLUGINS = 'SOURCE_PLUGINS';

export interface SourcePlugin<TConfig = unknown> {
  readonly sourceType: SourceType;
  /** Orchestrator skips any dao_source whose chain is not in this list. */
  readonly supportedChainIds: readonly string[];
  parseConfig(raw: unknown): TConfig;
  buildIngestSpec(ctx: SourceContext, cfg: TConfig): IngestSpec;
}

export type IngestSpec = {
  kind: 'evm-event-poller';
  filter: LogFilter;
  listener: EventsListener<LogEvent>;
};

export interface SourceContext {
  daoSourceId: string;
  sourceType: SourceType;
  chainId: string;
  sourceLabel: SourceType;
}
