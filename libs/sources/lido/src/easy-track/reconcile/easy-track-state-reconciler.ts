import type { Logger } from '@libs/chain';
import type { ReconcileOutcome, ReconcileRpcClient, StateReconciler } from '@sources/core';
import { decodeGetMotions, encodeGetMotions } from '../abi/getters';
import type {
  EasyTrackReconcileRepository,
  EasyTrackStaleReconciliationRow,
} from '../persistence/reconcile-repository';

interface MotionsSnapshot {
  /** motion id → objection-window end (startDate + duration), unix seconds. */
  windowEndById: Map<string, number>;
  /** confirmed-threshold block timestamp, unix seconds. */
  blockTs: number;
}

/**
 * getMotions-driven reconcile for Lido Easy Track (ADR-076 / ADR-049).
 *
 * A motion still present in `getMotions()` past its objection window has necessarily passed (objections
 * below threshold, else it would have been rejected-and-deleted). That window-close is **event-silent**
 * — no contract event marks it — so the reconciler advances the proposal `active → queued` (the
 * optimistic pass). Terminal transitions (enacted/rejected/canceled) emit events and stay event-backed,
 * so a motion *absent* from `getMotions()` is left to the confirmed-head pipeline (the reconciler does
 * not guess a terminal from absence — motions are deleted on close and indistinguishable by getter).
 */
export class EasyTrackStateReconciler implements StateReconciler<EasyTrackStaleReconciliationRow> {
  // Per-tick cache of getMotions() + the confirmed-block timestamp, keyed by
  // `${easyTrackAddress}:${confirmedThresholdTag}` — one RPC pair per tick, not per row.
  private snapshots = new Map<string, MotionsSnapshot>();
  private lastTag: string | undefined;

  constructor(
    private readonly logger: Logger,
    readonly sourceTypes: readonly string[],
  ) {}

  async reconcileRow(args: {
    row: EasyTrackStaleReconciliationRow;
    proposals: EasyTrackReconcileRepository;
    confirmedThreshold: bigint;
    confirmedThresholdTag: string;
    chainCtx: { client: ReconcileRpcClient; chainCfg: { chainId: string } };
  }): Promise<ReconcileOutcome> {
    const { row, proposals, confirmedThreshold, confirmedThresholdTag, chainCtx } = args;

    const snapshot = await this.loadSnapshot(
      chainCtx.client,
      row.easy_track_address,
      confirmedThresholdTag,
    );

    await proposals.markReconcileChecked(row.id, confirmedThreshold.toString());

    const windowEnd = snapshot.windowEndById.get(row.source_id);
    // Absent from getMotions() → the motion has closed; its terminal event is authoritative via the
    // confirmed-head pipeline. The reconciler does not infer a terminal from absence.
    if (windowEnd === undefined) return { outcome: 'closed' };
    // Still inside its objection window → genuinely active, nothing to correct yet.
    if (snapshot.blockTs < windowEnd) return { outcome: 'still_open' };

    // Window closed with the motion still on-chain → optimistic pass.
    const updated = await proposals.reconcileState({
      proposalId: row.id,
      expectedStates: ['active'],
      targetState: 'queued',
      stateUpdatedAt: new Date(snapshot.blockTs * 1000),
    });
    if (updated === 0) return { outcome: 'guard_skipped' };
    this.logger.debug('easy_track_optimistic_pass', {
      source_type: row.source_type,
      source_id: row.source_id,
    });
    return { outcome: 'corrected', fromState: row.state, toState: 'queued' };
  }

  private async loadSnapshot(
    client: ReconcileRpcClient,
    easyTrackAddress: string,
    confirmedThresholdTag: string,
  ): Promise<MotionsSnapshot> {
    // New confirmed head → drop the previous tick's cache (bounds memory to the current tick).
    if (this.lastTag !== confirmedThresholdTag) {
      this.snapshots.clear();
      this.lastTag = confirmedThresholdTag;
    }
    const key = `${easyTrackAddress.toLowerCase()}:${confirmedThresholdTag}`;
    const cached = this.snapshots.get(key);
    if (cached !== undefined) return cached;

    const raw = await client.send<string>('eth_call', [
      { to: easyTrackAddress, data: encodeGetMotions() },
      confirmedThresholdTag,
    ]);
    const windowEndById = new Map<string, number>();
    for (const motion of decodeGetMotions(raw)) {
      windowEndById.set(motion.id, motion.startDate + motion.duration);
    }

    const blockTs = await this.readBlockTimestamp(client, confirmedThresholdTag);
    const snapshot: MotionsSnapshot = { windowEndById, blockTs };
    this.snapshots.set(key, snapshot);
    return snapshot;
  }

  private async readBlockTimestamp(client: ReconcileRpcClient, blockTag: string): Promise<number> {
    const raw = await client.send<{ timestamp?: string }>('eth_getBlockByNumber', [
      blockTag,
      false,
    ]);
    const timestamp = raw?.timestamp;
    if (!timestamp) throw new Error('missing block timestamp');
    return Number(BigInt(timestamp));
  }
}
