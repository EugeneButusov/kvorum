export interface ReconcileRpcClient {
  send<T = unknown>(method: string, params: unknown[]): Promise<T>;
}

export interface ReconcilePerChainBound {
  chainId: string;
  confirmedThresholdBlock: string;
  recheckGapBlocks: number;
}

export interface ReconcileBound extends ReconcilePerChainBound {
  client: ReconcileRpcClient;
}

export interface BaseStaleReconciliationRow {
  id: string;
  source_id: string;
  source_type: string;
  chain_id: string;
}

export type ReconcileOutcome =
  | { outcome: 'corrected'; fromState: string; toState: string }
  | { outcome: string };

export interface ReconcilableProposalRepository<TRow extends BaseStaleReconciliationRow> {
  findStaleForReconciliation(
    sourceTypes: readonly string[],
    bounds: readonly ReconcilePerChainBound[],
    limit: number,
  ): Promise<TRow[]>;
}

export interface StateReconciler<TRow extends BaseStaleReconciliationRow> {
  readonly sourceTypes: readonly string[];
  reconcileRow(args: {
    row: TRow;
    proposals: ReconcilableProposalRepository<TRow>;
    confirmedThreshold: bigint;
    confirmedThresholdTag: string;
    chainCtx: {
      client: ReconcileRpcClient;
      chainCfg: { chainId: string };
    };
  }): Promise<ReconcileOutcome>;
}

export interface ReconcileDriverMetrics {
  recordBacklog(size: number): void;
  recordBatchSaturated(): void;
  recordOutcome(attrs: {
    source_type: string;
    outcome: string;
    from_state?: string;
    to_state?: string;
  }): void;
  recordRpcFailEscalated(sourceType: string): void;
  recordTickDurationSeconds(seconds: number): void;
}

export interface ReconcileDriverConfig {
  batchSize: number;
  rpcFailEscalateAfter: number;
}
