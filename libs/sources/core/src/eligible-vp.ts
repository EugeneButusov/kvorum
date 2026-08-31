/**
 * Contract for per-source eligible voting-power fetchers.
 *
 * Each source that contributes proposals with measurable eligible VP implements
 * this interface. The orchestrator (admin-cli `backfill eligible-vp`) discovers
 * providers via the registry and dispatches by `sourceTypes`.
 */

export interface EligibleVpProposalContext {
  sourceId: string;
  votingStartsBlock: string | null;
  primaryTokenAddress: string;
  votingAddress: string | null;
  votingStrategyAddress: string | null;
}

export type EligibleVpRpcSend = <T = unknown>(method: string, params: unknown[]) => Promise<T>;

export interface EligibleVpProvider {
  readonly sourceTypes: readonly string[];
  fetchEligibleVp(ctx: EligibleVpProposalContext, send: EligibleVpRpcSend): Promise<bigint | null>;
}
