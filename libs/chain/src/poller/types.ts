import type { RpcClient } from '../client/rpc-client.js';
import type { ChainConfig } from '../config/config.js';
import type { Logger } from '../logger.js';

/** Immutable post-construction. Address/topics are lowercased in the EventPoller
 *  constructor; the LogFilter the caller passes in is not mutated. */
export interface LogFilter {
  /** Single address or array (per eth_getLogs spec). */
  address: string | string[];
  /** Topic filters — null = wildcard at that position; nested array = OR-match. */
  topics?: Array<string | string[] | null>;
}

export interface LogEvent {
  sourceType: string;
  chainId: string;
  blockNumber: bigint;
  blockHash: string;
  txHash: string;
  txIndex: number;
  logIndex: number;
  address: string;
  topics: string[];
  data: string;
}

export interface Head {
  chainId: string;
  blockNumber: bigint;
  blockHash: string;
  parentHash: string;
  /** Chain-reported block timestamp (Unix seconds). */
  timestamp: bigint;
  /** Wall-clock when we received the response. */
  observedAt: Date;
}

/** Persistence port for one source's poll watermark. `libs/chain` stays storage-agnostic; the
 *  indexer binds this to `EvmPollCursorRepository`. */
export interface PollCursorStore {
  /** Block to resume *after*; null when the source has never been seen and the poller should fall
   *  back to its confirmed-head window rather than scanning history. */
  read(): Promise<bigint | null>;
  /** Called only once every listener has accepted the batch — see EventPoller.runTick. */
  write(lastPolledBlock: bigint): Promise<void>;
}

export interface EventPollerOptions {
  rpcClient: RpcClient;
  chainId: string;
  chainName: string;
  headLag: number;
  filter: LogFilter;
  /** Resumable watermark. Omit for the legacy head-anchored window (no catch-up after downtime). */
  cursor?: PollCursorStore;
  /** Max blocks fetched per tick while catching up. Default = 500 — providers cap eth_getLogs
   *  ranges, so a long outage is walked in chunks rather than demanded in one call. */
  maxBlocksPerTick?: number;
  /** Source type (e.g. 'compound_governor') — required for 5-tuple idempotency key
   *  composition by listeners and stamped onto LogEvent.sourceType. */
  sourceType: string;
  /** Opaque metric label — F1 supplies dao_source.id (UUID string). */
  daoSourceLabel: string;
  /** Polling cadence in ms. Default = 12_000 (ADR-037). */
  pollIntervalMs?: number;
  /** Hard cap on stop() drain time in ms. Default = 5_000. Also passed as deadlineMs
   *  to rpcClient.send during shutdown so in-flight requests honor the same budget. */
  stopTimeoutMs?: number;
  /** Fires once after the first tick where RPC succeeds and listeners resolve. */
  onFirstHeadComplete?: (headBlock: bigint) => void;
  logger?: Logger;
}

export interface HeadTrackerOptions {
  rpcClient: RpcClient;
  chainCfg: ChainConfig;
  pollIntervalMs?: number;
  stopTimeoutMs?: number;
  logger?: Logger;
}

export type EventsListener<T = LogEvent> = (evs: T[]) => void | Promise<void>;
export type HeadListener = (args: {
  head: Head;
  chainCfg: ChainConfig;
  headBlock: bigint;
  client: RpcClient;
}) => void | Promise<void>;
