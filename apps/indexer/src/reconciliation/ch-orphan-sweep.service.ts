import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DaoSourceRepository, ReconciliationWatermarkRepository } from '@libs/db';
import { reconciliationMetrics } from './reconciliation-metrics';

const SWEEP_NAME = 'ch_orphan';
const SWEEP_INTERVAL_MS = readIntervalMs('RECONCILIATION_SWEEP_INTERVAL_MS', 3_600_000);

@Injectable()
export class ChOrphanSweepService {
  private readonly logger = new Logger('ChOrphanSweep');
  private readonly inFlight = new Map<string, boolean>();

  constructor(
    private readonly daoSources: DaoSourceRepository,
    private readonly watermarkRepo: ReconciliationWatermarkRepository,
    @Inject('RECONCILIATION_KNOWN_EVENT_TYPES')
    private readonly knownEventTypes: readonly string[],
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async tick(): Promise<void> {
    const sources = await this.daoSources.findActive();
    const chains = [...new Set(sources.map((row) => row.primary_chain_id))];
    for (const chainId of chains) {
      await this.runOnce(chainId);
    }
  }

  async runOnce(chainId: string): Promise<void> {
    if (this.inFlight.get(chainId) === true) return;
    this.inFlight.set(chainId, true);
    const startedAt = Date.now();

    try {
      const sources = await this.daoSources.findActiveByChain(chainId);
      if (sources.length === 0) return;
      if (this.knownEventTypes.length === 0) return;

      for (const source of sources) {
        const current = await this.watermarkRepo.find(SWEEP_NAME, source.id);
        const floor = current?.blockNumber ?? BigInt(source.active_from_block ?? '0');
        reconciliationMetrics.watermarkLagBlocks.record(0, {
          sweep: SWEEP_NAME,
          dao_source_id: source.id,
        });

        await this.watermarkRepo.upsert(SWEEP_NAME, source.id, {
          blockNumber: floor,
        });
      }
    } catch (err) {
      this.logger.error('ch_orphan_tick_failed', { error: String(err), chain_id: chainId });
      reconciliationMetrics.chOrphanTotal.add(1, { result: 'error', dao_source_id: 'unknown' });
    } finally {
      reconciliationMetrics.sweepDurationSeconds.record((Date.now() - startedAt) / 1000, {
        sweep: SWEEP_NAME,
        dao_source_id: chainId,
      });
      this.inFlight.set(chainId, false);
    }
  }
}

function readIntervalMs(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
