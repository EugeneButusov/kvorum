import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AllProvidersFailedError, ClientStoppedError } from '@libs/chain';
import { ProposalRepository, type ProposalState, type ReconcilePerChainBound } from '@libs/db';
import {
  GovernorStateDecodeError,
  decodeGracePeriodResult,
  decodeStateResult,
  decodeTimelockResult,
  encodeGracePeriodCall,
  encodeStateCall,
  encodeTimelockCall,
  mapGovernorStateCode,
} from '@sources/compound';
import { ChainContextRegistry } from './chain-context-registry';
import { stateReconcilerMetrics } from './state-reconciler-metrics';

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
  private readonly graceCache = new Map<string, number>();
  private readonly rpcFailedStreak = new Map<string, number>();

  constructor(
    private readonly registry: ChainContextRegistry,
    private readonly proposals: ProposalRepository,
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
      if (bounds.length === 0) return;

      const batchSize = Number(process.env['STATE_RECONCILE_BATCH_SIZE'] ?? 50);
      const recheckGapBlocks = Number(process.env['STATE_RECONCILE_RECHECK_GAP_BLOCKS'] ?? 7_200);
      const rows = await this.proposals.findStaleForReconciliation(
        bounds,
        recheckGapBlocks,
        batchSize,
      );
      stateReconcilerMetrics.stateReconcileBacklog.record(rows.length);
      if (rows.length === batchSize) {
        stateReconcilerMetrics.stateReconcileBatchSaturated.add(1);
      }

      const boundsByChain = new Map(bounds.map((bound) => [bound.chainId, bound]));
      const rowsByChain = new Map<string, typeof rows>();
      for (const row of rows) {
        const bucket = rowsByChain.get(row.chain_id);
        if (bucket) {
          bucket.push(row);
        } else {
          rowsByChain.set(row.chain_id, [row]);
        }
      }

      for (const [chainId, chainRows] of rowsByChain) {
        const bound = boundsByChain.get(chainId);
        if (bound === undefined) continue;
        const ctx = this.registry.peek(chainId);
        if (ctx === undefined) continue;

        try {
          for (const row of chainRows) {
            try {
              await this.reconcileRow({
                row,
                chainId,
                confirmedThreshold: BigInt(bound.confirmedThresholdBlock),
                confirmedThresholdTag: toHexBlockTag(bound.confirmedThresholdBlock),
                ctx,
              });
            } catch (err) {
              if (err instanceof GovernorStateDecodeError) throw err;
              if (isTransientRpcError(err)) {
                this.recordRpcFailure(row, err);
                continue;
              }
              throw err;
            }
          }
        } catch (err) {
          if (err instanceof GovernorStateDecodeError) {
            this.logger.error('state_reconcile_decode_error', {
              chain_id: chainId,
              error: String(err),
            });
            continue;
          }
          throw err;
        }
      }
    } finally {
      stateReconcilerMetrics.stateReconcileTickDurationSeconds.record(
        (Date.now() - tickStart) / 1000,
      );
      this.inFlight = false;
    }
  }

  private async reconcileRow(args: {
    row: Awaited<ReturnType<ProposalRepository['findStaleForReconciliation']>>[number];
    chainId: string;
    confirmedThreshold: bigint;
    confirmedThresholdTag: string;
    ctx: ReturnType<ChainContextRegistry['peek']> extends infer T ? NonNullable<T> : never;
  }): Promise<void> {
    const { row, chainId, confirmedThreshold, confirmedThresholdTag, ctx } = args;

    let mapped: ProposalState;
    try {
      mapped = await this.readOnchainState({
        sourceId: row.source_id,
        governorAddress: row.governor_address,
        confirmedThresholdTag,
        ctx,
      });
    } catch (err) {
      this.recordRpcFailure(row, err);
      return;
    }

    this.rpcFailedStreak.delete(row.id);
    await this.proposals.markReconcileChecked(row.id, confirmedThreshold.toString());

    if (mapped === row.state) {
      this.recordOutcome(row.source_type, 'already_consistent');
      return;
    }

    if (mapped === 'executed' || mapped === 'queued' || mapped === 'canceled') {
      this.recordOutcome(row.source_type, 'missed_event');
      this.logger.error('state_reconcile_missed_event', {
        source_type: row.source_type,
        source_id: row.source_id,
        local_state: row.state,
        onchain_state: mapped,
      });
      return;
    }

    if (mapped === 'expired' && row.timelock_eta === null) {
      this.recordOutcome(row.source_type, 'expired_no_eta');
      this.logger.warn('state_reconcile_expired_no_eta', {
        source_type: row.source_type,
        source_id: row.source_id,
      });
      return;
    }

    let stateUpdatedAt: Date;
    if (mapped === 'defeated') {
      if (row.voting_ends_block === null) return;
      stateUpdatedAt = await this.readBlockTimestamp(ctx, row.voting_ends_block);
    } else if (mapped === 'active') {
      if (row.voting_starts_block === null) return;
      stateUpdatedAt = await this.readBlockTimestamp(ctx, row.voting_starts_block);
    } else if (mapped === 'expired') {
      const graceSeconds = await this.resolveGracePeriodSeconds({
        chainId,
        governorAddress: row.governor_address,
        confirmedThresholdTag,
        ctx,
      });
      if (graceSeconds === null || row.timelock_eta === null) return;
      stateUpdatedAt = new Date(row.timelock_eta.getTime() + graceSeconds * 1000);
    } else {
      return;
    }

    const updated = await this.proposals.reconcileState({
      proposalId: row.id,
      expectedStates: ['pending', 'active', 'succeeded', 'queued'],
      targetState: mapped,
      stateUpdatedAt,
    });

    if (updated === 0) {
      this.recordOutcome(row.source_type, 'guard_skipped');
      return;
    }

    stateReconcilerMetrics.stateReconcile.add(1, {
      source_type: row.source_type,
      outcome: 'corrected',
      from_state: row.state,
      to_state: mapped,
    });
    this.logger.log('state_reconcile_corrected', {
      source_type: row.source_type,
      source_id: row.source_id,
      from_state: row.state,
      to_state: mapped,
    });
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

  private async readOnchainState(args: {
    sourceId: string;
    governorAddress: string;
    confirmedThresholdTag: string;
    ctx: ReturnType<ChainContextRegistry['peek']> extends infer T ? NonNullable<T> : never;
  }): Promise<ProposalState> {
    const data = encodeStateCall(args.sourceId);
    const raw = await args.ctx.client.send<string>('eth_call', [
      { to: args.governorAddress, data },
      args.confirmedThresholdTag,
    ]);
    stateReconcilerMetrics.stateReconcileRpcCalls.add(1, {
      source_type: 'all',
      method: 'eth_call',
    });
    const code = decodeStateResult(raw);
    try {
      return mapGovernorStateCode(code);
    } catch (err) {
      this.recordOutcome('all', 'decode_failed');
      throw err;
    }
  }

  private async readBlockTimestamp(
    ctx: ReturnType<ChainContextRegistry['peek']> extends infer T ? NonNullable<T> : never,
    blockNumber: string,
  ): Promise<Date> {
    const raw = await ctx.client.send<{ timestamp?: string }>('eth_getBlockByNumber', [
      toHexBlockTag(blockNumber),
      false,
    ]);
    stateReconcilerMetrics.stateReconcileRpcCalls.add(1, {
      source_type: 'all',
      method: 'eth_getBlockByNumber',
    });
    const timestamp = raw?.timestamp;
    if (!timestamp) throw new Error('missing timestamp');
    return new Date(Number(BigInt(timestamp)) * 1000);
  }

  private async resolveGracePeriodSeconds(args: {
    chainId: string;
    governorAddress: string;
    confirmedThresholdTag: string;
    ctx: ReturnType<ChainContextRegistry['peek']> extends infer T ? NonNullable<T> : never;
  }): Promise<number | null> {
    const cacheKey = `${args.chainId}:${args.governorAddress.toLowerCase()}`;
    const cached = this.graceCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const timelockRaw = await args.ctx.client.send<string>('eth_call', [
        { to: args.governorAddress, data: encodeTimelockCall() },
        args.confirmedThresholdTag,
      ]);
      stateReconcilerMetrics.stateReconcileRpcCalls.add(1, {
        source_type: 'all',
        method: 'eth_call',
      });
      const timelockAddress = decodeTimelockResult(timelockRaw);
      const graceRaw = await args.ctx.client.send<string>('eth_call', [
        { to: timelockAddress, data: encodeGracePeriodCall() },
        args.confirmedThresholdTag,
      ]);
      stateReconcilerMetrics.stateReconcileRpcCalls.add(1, {
        source_type: 'all',
        method: 'eth_call',
      });
      const grace = decodeGracePeriodResult(graceRaw);
      const validated = this.validateGrace(grace);
      if (validated !== null) {
        this.graceCache.set(cacheKey, validated);
        return validated;
      }
    } catch {
      // fallback below
    }

    const fallbackRaw = process.env['GOVERNOR_GRACE_PERIOD_SECONDS'];
    const fallback = fallbackRaw === undefined ? null : this.validateGrace(Number(fallbackRaw));
    if (fallback !== null) {
      this.graceCache.set(cacheKey, fallback);
      return fallback;
    }

    this.logger.warn('state_reconcile_grace_invalid', {
      chain_id: args.chainId,
      governor_address: args.governorAddress,
    });
    return null;
  }

  private validateGrace(value: number): number | null {
    const min = Number(process.env['GOVERNOR_GRACE_MIN_SECONDS'] ?? 3_600);
    const max = Number(process.env['GOVERNOR_GRACE_MAX_SECONDS'] ?? 7_776_000);
    if (!Number.isInteger(value)) return null;
    if (value < min || value > max) return null;
    return value;
  }

  private recordOutcome(sourceType: string, outcome: ReconcileOutcome): void {
    stateReconcilerMetrics.stateReconcile.add(1, { source_type: sourceType, outcome });
  }

  private recordRpcFailure(
    row: Awaited<ReturnType<ProposalRepository['findStaleForReconciliation']>>[number],
    err: unknown,
  ): void {
    if (!(err instanceof AllProvidersFailedError) && !(err instanceof ClientStoppedError)) {
      throw err;
    }
    const streak = (this.rpcFailedStreak.get(row.id) ?? 0) + 1;
    this.rpcFailedStreak.set(row.id, streak);
    this.recordOutcome(row.source_type, 'rpc_failed');
    this.logger.warn('state_reconcile_rpc_failed', {
      source_type: row.source_type,
      source_id: row.source_id,
      streak,
      error: String(err),
    });

    const escalateAfter = Number(process.env['STATE_RECONCILE_RPC_FAIL_ESCALATE'] ?? 5);
    if (streak >= escalateAfter) {
      stateReconcilerMetrics.stateReconcileRpcFailEscalated.add(1, {
        source_type: row.source_type,
      });
      this.logger.error('state_reconcile_rpc_escalated', {
        source_type: row.source_type,
        source_id: row.source_id,
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
