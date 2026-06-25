import { silentLogger, type Logger } from '@libs/chain';
import {
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
  DaoSourceRepository,
  DlqRepository,
} from '@libs/db';
import { ArchiveFailureRouter, archiveEventTupleKey, type ProjectionDeriver } from '@sources/core';
import { projectDualGovernanceStateChange } from './state-projector';
import type { DualGovernanceEvent, DualGovernanceStateChangedPayload } from './types';
import { DualGovernanceArchivePayloadRepository } from '../persistence/archive-payload-repository';
import { DualGovernanceStateHistoryRepository } from '../persistence/state-history-repository';

const DLQ_THRESHOLD = Number(process.env['DG_STATE_PROJECTION_DLQ_THRESHOLD'] ?? '5');
const DG_STATE_PROJECTION_STAGE = 'dual_governance_state_projection_stage';

export type DualGovernanceStateDerivationOutcome = 'derived' | 'skipped_idempotent' | 'failed';
export type DualGovernanceStateDerivationFailureReason =
  | 'payload_missing'
  | 'decode_error'
  | 'projection_apply_error';

export interface DualGovernanceStateProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: DualGovernanceStateDerivationOutcome;
    reason: DualGovernanceStateDerivationFailureReason | null;
  }): void;
}

export interface DualGovernanceStateProjectionApplierDeps {
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: DualGovernanceArchivePayloadRepository;
  daoSources: DaoSourceRepository;
  history: DualGovernanceStateHistoryRepository;
  metrics: DualGovernanceStateProjectionMetrics;
  logger?: Logger;
}

type StateChangedEvent = Extract<DualGovernanceEvent, { type: 'DualGovernanceStateChanged' }>;

/**
 * Projects DualGovernanceStateChanged events into the append-only DAO-wide history (ADR-024).
 * One row per persisted transition; idempotent via the lido_002 unique index + the derivation
 * watermark. No proposal/correlation work (AB3) and no escrow reads (AB4).
 */
export class DualGovernanceStateProjectionApplier implements ProjectionDeriver {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['dual_governance'] as const;
  readonly eventTypes = ['DualGovernanceStateChanged'] as const;

  private readonly logger: Logger;
  private readonly failures: ArchiveFailureRouter;

  constructor(private readonly deps: DualGovernanceStateProjectionApplierDeps) {
    this.logger = deps.logger ?? silentLogger;
    this.failures = new ArchiveFailureRouter({
      archive: deps.archive,
      dlq: deps.dlq,
      stage: DG_STATE_PROJECTION_STAGE,
      source: 'indexer.dual_governance_state_projection',
      logEvent: 'dual_governance_state_derivation_failed',
      threshold: DLQ_THRESHOLD,
      logger: this.logger,
    });
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;

    const lookupStartedAt = Date.now();
    const payloads = await this.deps.payloads.fetchPayloads(rows);
    this.deps.metrics.batchLookupSeconds((Date.now() - lookupStartedAt) / 1000);
    const byKey = new Map(payloads.map((payload) => [archiveEventTupleKey(payload), payload]));

    for (const row of rows) {
      const payload = byKey.get(archiveEventTupleKey(row));
      if (payload === undefined) {
        await this.fail(row, 'payload_missing', new Error('archive payload missing'));
        continue;
      }

      let event: StateChangedEvent;
      try {
        event = parseStateChangedEvent(row.event_type, payload.payload);
      } catch (error) {
        await this.fail(row, 'decode_error', error);
        continue;
      }

      try {
        await this.apply(row, event);
      } catch (error) {
        await this.fail(row, 'projection_apply_error', error);
      }
    }
  }

  private async apply(row: ArchiveDerivationRow, event: StateChangedEvent): Promise<void> {
    const daoId = await this.deps.daoSources.findDaoIdForSource(row.dao_source_id);
    if (daoId === undefined) throw new Error(`unknown dao_source ${row.dao_source_id}`);

    const historyRow = projectDualGovernanceStateChange(event, {
      daoId,
      blockNumber: row.block_number,
      txHash: row.tx_hash,
      logIndex: row.log_index,
    });
    const { inserted } = await this.deps.history.insert(historyRow);
    // ON CONFLICT DO NOTHING + watermark: re-derivation no-ops both, so insert→markDerived is
    // replay-safe without a transaction.
    await this.deps.archive.markDerived(row.id);
    this.record(row, inserted ? 'derived' : 'skipped_idempotent', null);
  }

  private async fail(
    row: ArchiveDerivationRow,
    reason: DualGovernanceStateDerivationFailureReason,
    error: unknown,
  ): Promise<void> {
    await this.failures.route(row, reason, error);
    this.record(row, 'failed', reason);
  }

  private record(
    row: ArchiveDerivationRow,
    outcome: DualGovernanceStateDerivationOutcome,
    reason: DualGovernanceStateDerivationFailureReason | null,
  ): void {
    this.deps.metrics.processed({
      source_type: row.source_type,
      event_type: row.event_type,
      outcome,
      reason,
    });
  }
}

function parseStateChangedEvent(eventType: string, payloadJson: string): StateChangedEvent {
  if (eventType !== 'DualGovernanceStateChanged') {
    throw new Error(`unsupported dual_governance state event_type ${eventType}`);
  }
  return {
    type: 'DualGovernanceStateChanged',
    payload: JSON.parse(payloadJson) as DualGovernanceStateChangedPayload,
  };
}
