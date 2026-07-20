import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
  type OffchainArchiveRow,
} from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import { readIntervalMs } from '@libs/utils';
import {
  SOURCE_PLUGINS,
  type OffchainProjectionDeriver,
  type ProjectionDeriver,
  type SourcePlugin,
} from '@sources/core';
import { derivationMetrics } from './derivation-metrics';

const DERIVATION_INTERVAL_MS = readIntervalMs('DERIVATION_INTERVAL_MS', 5_000);
const DEFAULT_DERIVATION_BATCH_SIZE = 50;
const PROGRESS_LOG_INTERVAL_MS = 30_000;

type ChainContextRegistryLike = object;

@Injectable()
export class DerivationWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger('DerivationWorker');
  private readonly appliers: readonly ProjectionDeriver[];
  private readonly offchainAppliers: readonly OffchainProjectionDeriver[];
  private inFlight = false;
  private lastProgressLogAt = 0;
  private readonly eventTypes: readonly ArchiveEventType[];
  private readonly offchainEventTypes: readonly ArchiveEventType[];

  constructor(
    private readonly archiveDerivation: ArchiveDerivationRepository,
    private readonly actorResolution: ArchiveActorResolutionRepository,
    private readonly registry: ChainContextRegistryLike,
    @Inject(SOURCE_PLUGINS) plugins: readonly SourcePlugin[],
  ) {
    const derivers = plugins.flatMap((plugin) => plugin.derivers);
    this.appliers = derivers.filter(
      (deriver): deriver is ProjectionDeriver => deriver.kind === 'projection',
    );
    this.offchainAppliers = derivers.filter(
      (deriver): deriver is OffchainProjectionDeriver => deriver.kind === 'offchain-projection',
    );
    this.eventTypes = [...new Set(this.appliers.flatMap((applier) => applier.eventTypes))];
    this.offchainEventTypes = [
      ...new Set(this.offchainAppliers.flatMap((applier) => applier.eventTypes)),
    ];
  }

  async onApplicationBootstrap(): Promise<void> {
    void this.tick();
  }

  @Interval(DERIVATION_INTERVAL_MS)
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const startedAt = Date.now();

    try {
      const batchSize = Number(
        process.env['DERIVATION_BATCH_SIZE'] ?? DEFAULT_DERIVATION_BATCH_SIZE,
      );
      const watermark = await this.actorResolution.findDerivableBy(this.eventTypes, batchSize);
      const offchainWatermark = await this.actorResolution.findDerivableByOffchain(
        this.offchainEventTypes,
        batchSize,
      );
      if (watermark.length === 0 && offchainWatermark.length === 0) {
        derivationMetrics.lagSeconds.record(0);
        return;
      }

      const oldest = watermark[0] ?? offchainWatermark[0]!;
      const lagSeconds = computeLagSeconds(oldest.received_at);
      derivationMetrics.lagSeconds.record(lagSeconds, { source_type: oldest.source_type });

      for (const rows of splitIntoDispatchRuns(watermark)) {
        const first = rows.at(0);
        if (first === undefined) continue;
        const { source_type: sourceType, event_type: eventType } = first;
        const applier = this.appliers.find(
          (candidate) =>
            candidate.sourceTypes.includes(sourceType) && candidate.eventTypes.includes(eventType),
        );
        if (applier === undefined) {
          await this.markUnsupportedDispatch(rows);
          continue;
        }

        await applier.applyBatch(rows);
      }

      for (const rows of splitIntoDispatchRuns(offchainWatermark)) {
        const first = rows.at(0);
        if (first === undefined) continue;
        const { source_type: sourceType, event_type: eventType } = first;
        const applier = this.offchainAppliers.find(
          (candidate) =>
            candidate.sourceTypes.includes(sourceType) && candidate.eventTypes.includes(eventType),
        );
        if (applier === undefined) {
          await this.markUnsupportedDispatchOffchain(rows);
          continue;
        }

        await applier.applyBatch(rows);
      }

      const now = Date.now();
      if (now - this.lastProgressLogAt >= PROGRESS_LOG_INTERVAL_MS) {
        this.logger.log('derivation_progress', {
          batch: watermark.length + offchainWatermark.length,
          lag_s: Math.round(lagSeconds),
          // Distinct keys touched this tick; a key can span several runs when event types interleave.
          dispatches: [
            ...new Set(
              [...watermark, ...offchainWatermark].map(
                (row) => `${row.source_type}:${row.chain_id}:${row.event_type}`,
              ),
            ),
          ],
        });
        this.lastProgressLogAt = now;
      }
    } catch (err) {
      this.logger.error('derivation_tick_failed', { error: String(err) });
    } finally {
      derivationMetrics.tickDurationSeconds.record((Date.now() - startedAt) / 1000);
      this.inFlight = false;
    }
  }

  private async markUnsupportedDispatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    for (const row of rows) {
      derivationMetrics.processed.add(1, {
        source_type: row.source_type,
        event_type: row.event_type,
        outcome: 'failed',
        reason: 'unsupported_dispatch',
      });
      await this.archiveDerivation.incrementAttemptCount(row.id);
      this.logger.error('derivation_applier_missing', {
        row_id: row.id,
        source_type: row.source_type,
        chain_id: row.chain_id,
        tx_hash: row.tx_hash,
        log_index: row.log_index,
        block_hash: row.block_hash,
        event_type: row.event_type,
        attempt: row.derivation_attempt_count + 1,
      });
    }
  }

  private async markUnsupportedDispatchOffchain(
    rows: readonly OffchainArchiveRow[],
  ): Promise<void> {
    for (const row of rows) {
      derivationMetrics.processed.add(1, {
        source_type: row.source_type,
        event_type: row.event_type,
        outcome: 'failed',
        reason: 'unsupported_dispatch',
      });
      await this.archiveDerivation.incrementAttemptCount(row.id);
      this.logger.error('derivation_applier_missing', {
        row_id: row.id,
        source_type: row.source_type,
        chain_id: row.chain_id,
        external_id: row.external_id,
        event_type: row.event_type,
        attempt: row.derivation_attempt_count + 1,
      });
    }
  }
}

function computeLagSeconds(receivedAt: Date): number {
  return Math.max(0, (Date.now() - receivedAt.getTime()) / 1000);
}

/**
 * Splits the derivable rows into CONSECUTIVE runs of the same dispatch key, preserving the
 * (chain_id, block_number, log_index) order they were selected in.
 *
 * This used to collect every row of a key into one bucket and apply bucket-by-bucket, which
 * silently reordered events across types: a batch whose first row happened to be a
 * `ProposalCanceled` applied *every* cancel — including ones thousands of blocks later — before any
 * `ProposalCreated`. A transition landing before the create it depends on matches no proposal row,
 * and `advanceState` reports 0 updated rows, which is indistinguishable from "already in that
 * state" — so the transition was dropped without a trace. Compound bravo #347/#348 (canceled) and
 * alpha #4 (executed) sat in `pending` for exactly this reason.
 *
 * Runs keep each dispatch homogeneous (appliers rely on a single source_type/event_type per batch)
 * while guaranteeing an event is never applied before an earlier-block event of the same source.
 * The cost is more, smaller `applyBatch` calls when event types interleave.
 */
function splitIntoDispatchRuns<
  T extends { source_type: string; chain_id: string; event_type: ArchiveEventType },
>(rows: readonly T[]): T[][] {
  const runs: T[][] = [];
  let current: T[] = [];
  let currentKey: string | undefined;

  for (const row of rows) {
    const key = `${row.source_type}:${row.chain_id}:${row.event_type}`;
    if (key !== currentKey) {
      if (current.length > 0) runs.push(current);
      current = [];
      currentKey = key;
    }
    current.push(row);
  }
  if (current.length > 0) runs.push(current);

  return runs;
}
