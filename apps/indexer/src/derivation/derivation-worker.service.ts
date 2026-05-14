import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ArchiveDerivationRepository, type ArchiveDerivationRow } from '@libs/db';
import { derivationMetrics } from './derivation-metrics';
import { PROJECTION_APPLIERS, type ProjectionApplier } from './projection-applier';

const DERIVATION_INTERVAL_MS = readIntervalMs('DERIVATION_INTERVAL_MS', 5_000);
const DEFAULT_DERIVATION_BATCH_SIZE = 50;

@Injectable()
export class DerivationWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger('DerivationWorker');
  private inFlight = false;

  constructor(
    private readonly archive: ArchiveDerivationRepository,
    @Inject(PROJECTION_APPLIERS)
    private readonly appliers: readonly ProjectionApplier[],
  ) {}

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
      const watermark = await this.archive.findConfirmedUndderived(batchSize);
      if (watermark.length === 0) {
        derivationMetrics.lagSeconds.record(0, { source_type: 'compound_governor' });
        return;
      }

      const oldest = watermark[0]!;
      derivationMetrics.lagSeconds.record(computeLagSeconds(oldest.confirmed_at), {
        source_type: oldest.source_type,
      });

      const bySourceType = groupBySourceType(watermark);
      for (const [sourceType, rows] of bySourceType) {
        const applier = this.appliers.find((candidate) => candidate.sourceType === sourceType);
        if (applier === undefined) {
          await this.markUnsupportedSource(rows);
          continue;
        }

        await applier.applyBatch(rows);
      }
    } catch (err) {
      this.logger.error('derivation_tick_failed', { error: String(err) });
    } finally {
      derivationMetrics.tickDurationSeconds.record((Date.now() - startedAt) / 1000);
      this.inFlight = false;
    }
  }

  private async markUnsupportedSource(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    for (const row of rows) {
      derivationMetrics.processed.add(1, {
        source_type: row.source_type,
        event_type: row.event_type,
        outcome: 'failed',
        reason: 'unsupported_source',
      });
      await this.archive.incrementAttemptCount(row.id);
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
}

function computeLagSeconds(confirmedAt: Date | null): number {
  if (confirmedAt === null) return 0;
  return Math.max(0, (Date.now() - confirmedAt.getTime()) / 1000);
}

function groupBySourceType(
  rows: readonly ArchiveDerivationRow[],
): Map<string, ArchiveDerivationRow[]> {
  const grouped = new Map<string, ArchiveDerivationRow[]>();
  for (const row of rows) {
    const rowsForSource = grouped.get(row.source_type);
    if (rowsForSource === undefined) {
      grouped.set(row.source_type, [row]);
    } else {
      rowsForSource.push(row);
    }
  }
  return grouped;
}

function readIntervalMs(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
