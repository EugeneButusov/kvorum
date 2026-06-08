import type { Kysely } from 'kysely';
import { silentLogger, type ChainContextRegistry, type Logger } from '@libs/chain';
import {
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
  type DlqRepository,
  type PgDatabase,
  ProposalRepository,
} from '@libs/db';
import { VoteBlockTimestampFetcher } from '@sources/core';
import { projectPayloadActions, statusTransitionFor } from './payload-status-projector';
import type { PayloadCreatedPayload, PayloadLifecyclePayload } from './types';
import { AaveProposalRepository } from '../../persistence/aave-proposal-repository';
import {
  AavePayloadsControllerArchivePayloadRepository,
  type AavePayloadsControllerArchivePayloadRow,
} from '../persistence/archive-payload-repository';

const DLQ_THRESHOLD = Number(process.env['PAYLOAD_PROJECTION_DLQ_THRESHOLD'] ?? '5');
const PAYLOAD_PROJECTION_STAGE = 'aave_payload_projection_stage';
const HOLD_LOG_INTERVAL_MS = 30_000;

export type AavePayloadDerivationOutcome = 'derived' | 'skipped_idempotent' | 'failed' | 'held';
export type AavePayloadDerivationFailureReason =
  | 'decode_error'
  | 'payload_missing'
  | 'block_timestamp_unavailable'
  | 'watermark_update_error'
  | 'projection_apply_error'
  | 'no_declared_payload';

export interface AavePayloadProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  stitchPendingSeconds?(
    seconds: number,
    labels: { target_chain_id: string; event_type: string },
  ): void;
  processed(labels: {
    event_type: string;
    outcome: AavePayloadDerivationOutcome;
    reason: AavePayloadDerivationFailureReason | null;
  }): void;
}

export interface AavePayloadStitchApplierDeps {
  pgDb: Kysely<PgDatabase>;
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: AavePayloadsControllerArchivePayloadRepository;
  proposals: ProposalRepository;
  aaveProposals: AaveProposalRepository;
  registry: ChainContextRegistry;
  metrics: AavePayloadProjectionMetrics;
  logger?: Logger;
}

export class AavePayloadStitchApplier {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['aave_payloads_controller'] as const;
  readonly eventTypes = [
    'PayloadCreated',
    'PayloadQueued',
    'PayloadExecuted',
    'PayloadCancelled',
  ] as const;

  private readonly blockTimestamps = new VoteBlockTimestampFetcher();
  private readonly logger: Logger;
  private readonly lastHoldLogByKey = new Map<string, number>();

  constructor(private readonly deps: AavePayloadStitchApplierDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;
    const firstRow = rows[0];
    if (firstRow === undefined) return;

    const lookupStartedAt = Date.now();
    const payloads = await this.deps.payloads.fetchPayloads(rows);
    this.deps.metrics.batchLookupSeconds((Date.now() - lookupStartedAt) / 1000);
    const payloadByKey = new Map(payloads.map((payload) => [tupleKey(payload), payload]));

    const controllerByDaoSource = new Map<string, string | undefined>();
    const daoSourceIds = [...new Set(rows.map((row) => row.dao_source_id))];
    await Promise.all(
      daoSourceIds.map(async (daoSourceId) => {
        controllerByDaoSource.set(
          daoSourceId,
          await this.deps.aaveProposals.findPayloadsControllerAddress(daoSourceId),
        );
      }),
    );

    let executedAtByKey: Map<string, Date> | undefined;
    if (firstRow.event_type === 'PayloadExecuted') {
      const chainCtx = this.deps.registry.peek(firstRow.chain_id);
      if (chainCtx === undefined) {
        for (const row of rows) {
          await this.failAndMaybeDlq(
            row,
            'block_timestamp_unavailable',
            new Error('chain context missing'),
          );
        }
        return;
      }

      executedAtByKey = await this.blockTimestamps.fetchBatch(
        chainCtx,
        rows.map((row) => ({ blockNumber: row.block_number, blockHash: row.block_hash })),
      );
    }

    let pendingMaxSeconds = 0;
    for (const row of rows) {
      const payloadRow = payloadByKey.get(tupleKey(row));
      if (payloadRow === undefined) {
        await this.failAndMaybeDlq(row, 'payload_missing', new Error('archive payload missing'));
        continue;
      }

      const controller = controllerByDaoSource.get(row.dao_source_id);
      if (controller === undefined) {
        await this.failAndMaybeDlq(
          row,
          'projection_apply_error',
          new Error(`payloads_controller_address missing for dao_source ${row.dao_source_id}`),
        );
        continue;
      }

      let payload: PayloadCreatedPayload | PayloadLifecyclePayload;
      try {
        payload = JSON.parse(payloadRow.payload) as PayloadCreatedPayload | PayloadLifecyclePayload;
      } catch (error) {
        await this.failAndMaybeDlq(row, 'decode_error', error);
        continue;
      }

      const declared = await this.deps.aaveProposals.findDeclaredPayload({
        targetChainId: row.chain_id,
        payloadsControllerAddress: controller,
        payloadId: payload.payloadId,
      });
      if (declared === undefined) {
        this.record(row, 'held', 'no_declared_payload');
        pendingMaxSeconds = Math.max(
          pendingMaxSeconds,
          (Date.now() - row.received_at.getTime()) / 1000,
        );
        continue;
      }

      const transition = statusTransitionFor(row.event_type);
      const executedAtDestination =
        row.event_type === 'PayloadExecuted'
          ? executedAtByKey?.get(this.blockTimestamps.resultKey(row.block_number, row.block_hash))
          : undefined;
      if (row.event_type === 'PayloadExecuted' && executedAtDestination === undefined) {
        await this.failAndMaybeDlq(
          row,
          'block_timestamp_unavailable',
          new Error(`block timestamp unavailable for ${row.block_number}`),
        );
        continue;
      }

      try {
        const outcome = await this.deps.pgDb.transaction().execute(async (tx) => {
          const txAaveProposals = new AaveProposalRepository(tx);
          const txProposals = new ProposalRepository(tx);
          const txArchive = new ArchiveDerivationRepository(tx);

          const advanced = await txAaveProposals.advancePayloadStatus({
            id: declared.id,
            targetStatus: transition.targetStatus,
            allowedFrom: transition.allowedFrom,
            executedAtDestination,
          });

          const insertedActions =
            row.event_type === 'PayloadCreated'
              ? await txProposals.insertActions(
                  declared.proposal_id,
                  projectPayloadActions(payload as PayloadCreatedPayload, row.chain_id),
                  declared.payload_index,
                )
              : 0;

          try {
            await txArchive.markDerived(row.id);
          } catch (error) {
            throw new WatermarkUpdateError(error);
          }

          return advanced > 0 || insertedActions > 0 ? 'derived' : 'skipped_idempotent';
        });

        this.record(row, outcome, null);
      } catch (error) {
        if (error instanceof WatermarkUpdateError) {
          await this.failAndMaybeDlq(row, 'watermark_update_error', error.cause);
          continue;
        }

        await this.failAndMaybeDlq(row, 'projection_apply_error', error);
      }
    }

    this.recordStitchPendingSeconds(firstRow, pendingMaxSeconds);
  }

  private async failAndMaybeDlq(
    row: ArchiveDerivationRow,
    reason: Exclude<AavePayloadDerivationFailureReason, 'no_declared_payload'>,
    error: unknown,
  ): Promise<void> {
    this.record(row, 'failed', reason);
    await this.deps.archive.incrementAttemptCount(row.id);
    const attempt = row.derivation_attempt_count + 1;
    this.logger.error('aave_payload_derivation_failed', {
      row_id: row.id,
      source_type: row.source_type,
      event_type: row.event_type,
      chain_id: row.chain_id,
      tx_hash: row.tx_hash,
      log_index: row.log_index,
      block_hash: row.block_hash,
      attempt,
      reason,
      error: String(error),
    });

    if (attempt < DLQ_THRESHOLD) return;

    await this.deps.dlq.insert({
      stage: PAYLOAD_PROJECTION_STAGE,
      source: 'indexer.aave_payload_projection',
      payload: {
        id: row.id,
        source_type: row.source_type,
        chain_id: row.chain_id,
        tx_hash: row.tx_hash,
        log_index: row.log_index,
        block_hash: row.block_hash,
        event_type: row.event_type,
      },
      error: { message: String(error) },
      retries: attempt,
      first_seen_at: new Date(),
      last_attempt_at: new Date(),
      archive_source_type: row.source_type,
      archive_chain_id: row.chain_id,
      archive_tx_hash: row.tx_hash,
      archive_log_index: row.log_index,
      archive_block_hash: row.block_hash,
    });
  }

  private recordStitchPendingSeconds(row: ArchiveDerivationRow, pendingMaxSeconds: number): void {
    this.deps.metrics.stitchPendingSeconds?.(pendingMaxSeconds, {
      target_chain_id: row.chain_id,
      event_type: row.event_type,
    });
    this.maybeLogHold(row, pendingMaxSeconds);
  }

  private maybeLogHold(row: ArchiveDerivationRow, pendingMaxSeconds: number): void {
    if (pendingMaxSeconds <= 0) return;

    const key = `${row.chain_id}:${row.event_type}`;
    const nowMs = Date.now();
    const lastLoggedAt = this.lastHoldLogByKey.get(key) ?? 0;
    if (nowMs - lastLoggedAt < HOLD_LOG_INTERVAL_MS) return;

    this.lastHoldLogByKey.set(key, nowMs);
    this.logger.info('aave_payload_stitch_held', {
      chain_id: row.chain_id,
      event_type: row.event_type,
      oldest_pending_seconds: pendingMaxSeconds,
    });
  }

  private record(
    row: ArchiveDerivationRow,
    outcome: AavePayloadDerivationOutcome,
    reason: AavePayloadDerivationFailureReason | null,
  ): void {
    this.deps.metrics.processed({
      event_type: row.event_type,
      outcome,
      reason,
    });
  }
}

class WatermarkUpdateError extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super('failed to mark archive row derived');
    this.cause = cause;
  }
}

function tupleKey(
  row:
    | ArchiveDerivationRow
    | Pick<
        AavePayloadsControllerArchivePayloadRow,
        'chain_id' | 'tx_hash' | 'log_index' | 'block_hash'
      >,
): string {
  return `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}`;
}
