import type { Logger } from '../logger.js';
import type { RpcClient } from '../client/rpc-client.js';

export type ProxyKind = 'eip1967' | 'eip1967-beacon' | 'eip1822' | 'oz-zeppelinos';

export type ResolutionReason = 'resolved' | 'not_a_proxy' | 'capped' | 'cycle' | 'all_slots_failed';

export interface ResolutionStep {
  /** Lowercased proxy address at this hop. */
  proxyAddress: string;
  /** Storage slot that resolved (one of the canonical constants). */
  slot: string;
  kind: ProxyKind;
}

export interface ResolutionResult {
  /** Final implementation address (lowercased) — or null if input wasn't a proxy or chain cycled. */
  implementation: string | null;
  /** Chain traversed; length 0 if input wasn't a proxy. */
  path: ResolutionStep[];
  /** True iff recursion cap was hit. */
  capped: boolean;
  /** Structured outcome — callers branch on this rather than inferring from the other fields. */
  reason: ResolutionReason;
}

export interface ResolverOptions {
  rpcClient: RpcClient;
  /** Chain identifier for metric labels (e.g., 'ethereum'). */
  chainName: string;
  /** Hard cap on recursion depth. Default 3. */
  maxDepth?: number;
  logger?: Logger;
}
