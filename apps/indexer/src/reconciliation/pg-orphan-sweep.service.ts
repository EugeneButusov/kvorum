import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DaoSourceRepository, DlqRepository, ReconciliationWatermarkRepository } from '@libs/db';
import { reconciliationMetrics } from './reconciliation-metrics';

const SWEEP_NAME = 'pg_orphan';
const SWEEP_INTERVAL_MS = readIntervalMs('RECONCILIATION_SWEEP_INTERVAL_MS', 3_600_000);
export const RECONCILIATION_PG_ORPHAN_STAGE = 'reconciliation_pg_orphan_stage';

@Injectable()
export class PgOrphanSweepService {
  private readonly logger = new Logger('PgOrphanSweep');
  private readonly inFlight = new Map<string, boolean>();

  constructor(
    private readonly daoSources: DaoSourceRepository,
    private readonly watermarkRepo: ReconciliationWatermarkRepository,
    private readonly dlqRepo: DlqRepository,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async tick(): Promise<void> {
    const sources = await this.daoSources.findActive();
    for (const source of sources) {
      await this.runOnce(source.id);
    }
  }

  async runOnce(daoSourceId: string): Promise<void> {
    if (this.inFlight.get(daoSourceId) === true) return;
    this.inFlight.set(daoSourceId, true);
    const startedAt = Date.now();

    try {
      void this.dlqRepo;
      const current = await this.watermarkRepo.find(SWEEP_NAME, daoSourceId);
      const blockNumber = current?.blockNumber ?? 0n;
      await this.watermarkRepo.upsert(SWEEP_NAME, daoSourceId, {
        blockNumber,
        txHash: current?.txHash ?? '',
        logIndex: current?.logIndex ?? 0,
      });
      reconciliationMetrics.pgOrphanTotal.add(0, {
        result: 'routed_to_dlq',
        dao_source_id: daoSourceId,
      });
    } catch (err) {
      this.logger.error('pg_orphan_tick_failed', {
        error: String(err),
        dao_source_id: daoSourceId,
      });
      reconciliationMetrics.pgOrphanTotal.add(1, { result: 'error', dao_source_id: daoSourceId });
    } finally {
      reconciliationMetrics.sweepDurationSeconds.record((Date.now() - startedAt) / 1000, {
        sweep: SWEEP_NAME,
        dao_source_id: daoSourceId,
      });
      this.inFlight.set(daoSourceId, false);
    }
  }
}

function readIntervalMs(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
