import { Injectable, Logger, Inject } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import {
  AllProvidersFailedError,
  ClientStoppedError,
  type Logger as ChainLogger,
} from '@libs/chain';
import {
  CompoundProposalRepository,
  CompoundStateReconciler,
  type ReconcilePerChainBound,
} from '@sources/compound';
import { stateReconcilerMetrics } from './state-reconciler-metrics';

interface IChainContext {
  headTracker: { getLastHead(): { blockNumber: bigint } | null };
  chainCfg: { chainId: string; reorgHorizon: number; sweepIntervalMs?: number };
  client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
}

interface IChainContextRegistry {
  allActive(): IChainContext[];
  peek(chainId: string): IChainContext | undefined;
}

type ReconcileOutcome =
  | 'corrected'
  | 'already_consistent'
  | 'guard_skipped'
  | 'missed_event'
  | 'expired_no_queued_block'
  | 'rpc_failed'
  | 'decode_failed';

function toChainLogger(nestLogger: Logger): ChainLogger {
  return {
    info: (msg, ...args) => nestLogger.log(msg, ...args),
    warn: (msg, ...args) => nestLogger.warn(msg, ...args),
    error: (msg, ...args) => nestLogger.error(msg, ...args),
    debug: (msg, ...args) => nestLogger.debug(msg, ...args),
  };
}

@Injectable()
export class CompoundReconcileService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('CompoundReconcile');
  private readonly reconciler = new CompoundStateReconciler(
    toChainLogger(new Logger('CompoundStateReconciler')),
  );
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private readonly rpcFailedStreak = new Map<string, number>();

  constructor(
    @Inject('ChainContextRegistry') private readonly registry: IChainContextRegistry,
    private readonly proposals: CompoundProposalRepository,
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
      const bounds = this.computeBounds();
      if (bounds.length === 0) return;

      const batchSize = Number(process.env['STATE_RECONCILE_BATCH_SIZE'] ?? 50);
      const recheckGapBlocks = Number(process.env['STATE_RECONCILE_RECHECK_GAP_BLOCKS'] ?? 7_200);
      const rows = await this.proposals.findStaleForReconciliation(
        [this.reconciler.sourceType],
        bounds,
        recheckGapBlocks,
        batchSize,
      );
      stateReconcilerMetrics.stateReconcileBacklog.record(rows.length);
      if (rows.length === batchSize) stateReconcilerMetrics.stateReconcileBatchSaturated.add(1);

      const boundsByChain = new Map(bounds.map((b) => [b.chainId, b]));
      for (const row of rows) {
        const bound = boundsByChain.get(row.chain_id);
        if (!bound) continue;

        const ctx = this.registry.peek(row.chain_id);
        if (!ctx) continue;

        try {
          const result = await this.reconciler.reconcileRow({
            row,
            confirmedThreshold: BigInt(bound.confirmedThresholdBlock),
            confirmedThresholdTag: `0x${BigInt(bound.confirmedThresholdBlock).toString(16)}`,
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

  private computeBounds(): ReconcilePerChainBound[] {
    const bounds: ReconcilePerChainBound[] = [];
    for (const ctx of this.registry.allActive()) {
      const head = ctx.headTracker.getLastHead();
      if (head === null) continue;

      const horizon = BigInt(ctx.chainCfg.reorgHorizon);
      if (head.blockNumber < horizon) continue;

      bounds.push({
        chainId: ctx.chainCfg.chainId,
        confirmedThresholdBlock: (head.blockNumber - horizon).toString(),
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
    _err: AllProvidersFailedError | ClientStoppedError,
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

function isTransientRpcError(err: unknown): err is AllProvidersFailedError | ClientStoppedError {
  return err instanceof AllProvidersFailedError || err instanceof ClientStoppedError;
}
