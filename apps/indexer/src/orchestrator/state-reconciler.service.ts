import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AllProvidersFailedError, ClientStoppedError } from '@libs/chain';
import { ProposalRepository, type ReconcilePerChainBound } from '@libs/db';
import type { ProposalStateReconcilerPlugin } from '@sources/core';
import { stateReconcilerMetrics } from './state-reconciler-metrics';
import { ChainContextRegistry } from './chain-context-registry';
import { STATE_RECONCILERS } from './tokens';

type ReconcileOutcome =
  | 'corrected'
  | 'already_consistent'
  | 'guard_skipped'
  | 'missed_event'
  | 'expired_no_eta'
  | 'rpc_failed'
  | 'decode_failed';

@Injectable()
export class StateReconcilerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('StateReconciler');
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private readonly rpcFailedStreak = new Map<string, number>();

  constructor(
    private readonly registry: ChainContextRegistry,
    private readonly proposals: ProposalRepository,
    @Inject(STATE_RECONCILERS)
    private readonly reconcilers: readonly ProposalStateReconcilerPlugin[],
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const firstChainMs = this.registry.allActive()[0]?.chainCfg.sweepIntervalMs;
    const sweepIntervalMs = firstChainMs ?? Number(process.env['SWEEP_INTERVAL_MS'] ?? 30_000);
    void this.tick();
    this.interval = setInterval(() => void this.tick(), sweepIntervalMs);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const tickStart = Date.now();

    try {
      const bounds = await this.computeBounds();
      if (bounds.length === 0 || this.reconcilers.length === 0) return;

      const sourceTypes = this.reconcilers.map((x) => x.sourceType);
      const bySourceType = new Map(this.reconcilers.map((x) => [x.sourceType, x]));

      const batchSize = Number(process.env['STATE_RECONCILE_BATCH_SIZE'] ?? 50);
      const recheckGapBlocks = Number(process.env['STATE_RECONCILE_RECHECK_GAP_BLOCKS'] ?? 7_200);
      const rows = await this.proposals.findStaleForReconciliation(
        sourceTypes,
        bounds,
        recheckGapBlocks,
        batchSize,
      );
      stateReconcilerMetrics.stateReconcileBacklog.record(rows.length);
      if (rows.length === batchSize) stateReconcilerMetrics.stateReconcileBatchSaturated.add(1);

      const boundsByChain = new Map(bounds.map((bound) => [bound.chainId, bound]));
      for (const row of rows) {
        const reconciler = bySourceType.get(row.source_type);
        if (!reconciler) continue;

        const bound = boundsByChain.get(row.chain_id);
        if (!bound) continue;

        const ctx = this.registry.peek(row.chain_id);
        if (!ctx) continue;

        try {
          const result = await reconciler.reconcileRow({
            row,
            confirmedThreshold: BigInt(bound.confirmedThresholdBlock),
            confirmedThresholdTag: toHexBlockTag(bound.confirmedThresholdBlock),
            proposals: this.proposals,
            chainCtx: ctx,
          });

          this.rpcFailedStreak.delete(row.id);

          if (result.outcome === 'corrected') {
            stateReconcilerMetrics.stateReconcile.add(1, {
              source_type: row.source_type,
              outcome: 'corrected',
              from_state: result.fromState,
              to_state: result.toState,
            });
          } else {
            this.recordOutcome(row.source_type, result.outcome);
          }
        } catch (err) {
          if (isTransientRpcError(err)) {
            this.recordRpcFailure(row.id, row.source_type, row.source_id, err);
            continue;
          }
          this.recordOutcome(row.source_type, 'decode_failed');
          this.logger.error('state_reconcile_decode_error', {
            source_type: row.source_type,
            source_id: row.source_id,
            error: String(err),
          });
        }
      }
    } finally {
      stateReconcilerMetrics.stateReconcileTickDurationSeconds.record(
        (Date.now() - tickStart) / 1000,
      );
      this.inFlight = false;
    }
  }

  private async computeBounds(): Promise<ReconcilePerChainBound[]> {
    const bounds: ReconcilePerChainBound[] = [];
    for (const ctx of this.registry.allActive()) {
      const head = ctx.headTracker.getLastHead();
      if (head === null) continue;

      const horizon = BigInt(ctx.chainCfg.reorgHorizon);
      if (head.blockNumber < horizon) continue;

      const confirmedThreshold = head.blockNumber - horizon;
      const block = await ctx.client.send<{ timestamp?: string }>('eth_getBlockByNumber', [
        `0x${confirmedThreshold.toString(16)}`,
        false,
      ]);
      stateReconcilerMetrics.stateReconcileRpcCalls.add(1, {
        source_type: 'all',
        method: 'eth_getBlockByNumber',
      });
      if (!block?.timestamp) continue;

      bounds.push({
        chainId: ctx.chainCfg.chainId,
        confirmedThresholdBlock: confirmedThreshold.toString(),
        confirmedThresholdTs: new Date(Number(BigInt(block.timestamp)) * 1000),
      });
    }
    return bounds;
  }

  private recordOutcome(sourceType: string, outcome: ReconcileOutcome): void {
    stateReconcilerMetrics.stateReconcile.add(1, { source_type: sourceType, outcome });
  }

  private recordRpcFailure(
    proposalId: string,
    sourceType: string,
    sourceId: string,
    err: AllProvidersFailedError | ClientStoppedError,
  ): void {
    const streak = (this.rpcFailedStreak.get(proposalId) ?? 0) + 1;
    this.rpcFailedStreak.set(proposalId, streak);
    this.recordOutcome(sourceType, 'rpc_failed');

    const escalateAfter = Number(process.env['STATE_RECONCILE_RPC_FAIL_ESCALATE'] ?? 5);
    if (streak >= escalateAfter) {
      stateReconcilerMetrics.stateReconcileRpcFailEscalated.add(1, { source_type: sourceType });
      this.logger.error('state_reconcile_rpc_escalated', {
        source_type: sourceType,
        source_id: sourceId,
        streak,
      });
    }
  }
}

function toHexBlockTag(blockNumber: string): string {
  return `0x${BigInt(blockNumber).toString(16)}`;
}

function isTransientRpcError(err: unknown): err is AllProvidersFailedError | ClientStoppedError {
  return err instanceof AllProvidersFailedError || err instanceof ClientStoppedError;
}
