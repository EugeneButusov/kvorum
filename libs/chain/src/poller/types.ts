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

export interface EventPollerOptions {
  rpcClient: RpcClient;
  chainId: string;
  chainName: string;
  reorgHorizon: number;
  filter: LogFilter;
  /** Source type (e.g. 'compound_governor') — required for 5-tuple idempotency key
   *  composition by listeners and stamped onto LogEvent.sourceType. */
  sourceType: string;
  /** Opaque metric label — F1 supplies dao_source.id (UUID string). */
  daoSourceLabel: string;
  /** Optional one-time lower bound for the first successful tick's fromBlock.
   *  Used to bridge startup backfill -> live poller handoff without a hole. */
  bootstrapFromBlock?: bigint;
  /** Polling cadence in ms. Default = 12_000 (ADR-037). */
  pollIntervalMs?: number;
  /** Hard cap on stop() drain time in ms. Default = 5_000. Also passed as deadlineMs
   *  to rpcClient.send during shutdown so in-flight requests honor the same budget. */
  stopTimeoutMs?: number;
  /** Invoked after a block window poll where RPC calls succeeded and all listeners resolved.
   *  Fires even when events.length === 0. */
  onBlockComplete?: (headBlock: bigint) => void | Promise<void>;
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
