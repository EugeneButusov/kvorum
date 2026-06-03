import { AllProvidersFailedError, ClientStoppedError, type Logger } from '@libs/chain';
import type {
  BaseStaleReconciliationRow,
  ReconcileBound,
  ReconcileDriverConfig,
  ReconcileDriverMetrics,
  ReconcilableProposalRepository,
  StateReconciler,
} from './types';

export class ReconcileDriver<TRow extends BaseStaleReconciliationRow> {
  private inFlight = false;
  private readonly rpcFailedStreak = new Map<string, number>();

  constructor(
    private readonly reconciler: StateReconciler<TRow>,
    private readonly proposals: ReconcilableProposalRepository<TRow>,
    private readonly metrics: ReconcileDriverMetrics,
    private readonly logger: Logger,
    private readonly config: ReconcileDriverConfig,
  ) {}

  async onConfirmedHeads(bounds: readonly ReconcileBound[]): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const tickStart = Date.now();

    try {
      if (bounds.length === 0) return;

      const rows = await this.proposals.findStaleForReconciliation(
        [...this.reconciler.sourceTypes],
        bounds,
        this.config.batchSize,
      );
      this.metrics.recordBacklog(rows.length);
      if (rows.length === this.config.batchSize) this.metrics.recordBatchSaturated();

      const boundsByChain = new Map(bounds.map((bound) => [bound.chainId, bound]));
      for (const row of rows) {
        const bound = boundsByChain.get(row.chain_id);
        if (!bound) continue;

        try {
          const result = await this.reconciler.reconcileRow({
            row,
            confirmedThreshold: BigInt(bound.confirmedThresholdBlock),
            confirmedThresholdTag: `0x${BigInt(bound.confirmedThresholdBlock).toString(16)}`,
            proposals: this.proposals,
            chainCtx: {
              client: bound.client,
              chainCfg: { chainId: bound.chainId },
            },
          });

          this.rpcFailedStreak.delete(row.id);

          if ('fromState' in result && 'toState' in result) {
            this.metrics.recordOutcome({
              source_type: row.source_type,
              outcome: 'corrected',
              from_state: result.fromState,
              to_state: result.toState,
            });
          } else {
            this.metrics.recordOutcome({ source_type: row.source_type, outcome: result.outcome });
          }
        } catch (err) {
          if (isTransientRpcError(err)) {
            this.handleRpcFailure(row.id, row.source_type, row.source_id, err);
            continue;
          }
          this.metrics.recordOutcome({ source_type: row.source_type, outcome: 'decode_failed' });
          this.logger.error('state_reconcile_decode_error', {
            source_type: row.source_type,
            source_id: row.source_id,
            error: String(err),
          });
        }
      }
    } finally {
      this.metrics.recordTickDurationSeconds((Date.now() - tickStart) / 1000);
      this.inFlight = false;
    }
  }

  private handleRpcFailure(
    proposalId: string,
    sourceType: string,
    sourceId: string,
    _err: AllProvidersFailedError | ClientStoppedError,
  ): void {
    const streak = (this.rpcFailedStreak.get(proposalId) ?? 0) + 1;
    this.rpcFailedStreak.set(proposalId, streak);
    this.metrics.recordOutcome({ source_type: sourceType, outcome: 'rpc_failed' });

    if (streak >= this.config.rpcFailEscalateAfter) {
      this.metrics.recordRpcFailEscalated(sourceType);
      this.logger.error('state_reconcile_rpc_escalated', {
        source_type: sourceType,
        source_id: sourceId,
        streak,
      });
    }
  }
}

export function isTransientRpcError(
  err: unknown,
): err is AllProvidersFailedError | ClientStoppedError {
  return err instanceof AllProvidersFailedError || err instanceof ClientStoppedError;
}
