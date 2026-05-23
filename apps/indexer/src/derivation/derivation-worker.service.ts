import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
} from '@libs/db';
import {
  makeCutoffClassifier,
  SOURCE_PLUGINS,
  type ProjectionDeriver,
  type SourcePlugin,
} from '@sources/core';
import { derivationMetrics } from './derivation-metrics';

const DERIVATION_INTERVAL_MS = readIntervalMs('DERIVATION_INTERVAL_MS', 5_000);
const DEFAULT_DERIVATION_BATCH_SIZE = 50;
const PROGRESS_LOG_INTERVAL_MS = 30_000;

interface ChainContextRegistryLike {
  peek(chainId: string):
    | {
        client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
        chainCfg: { reorgHorizon: number };
      }
    | undefined;
}

@Injectable()
export class DerivationWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger('DerivationWorker');
  private readonly appliers: readonly ProjectionDeriver[];
  private inFlight = false;
  private lastProgressLogAt = 0;
  private readonly eventTypes: readonly string[];

  constructor(
    private readonly archiveDerivation: ArchiveDerivationRepository,
    private readonly actorResolution: ArchiveActorResolutionRepository,
    private readonly registry: ChainContextRegistryLike,
    @Inject(SOURCE_PLUGINS) plugins: readonly SourcePlugin[],
  ) {
    this.appliers = plugins
      .flatMap((plugin) => plugin.derivers)
      .filter((deriver): deriver is ProjectionDeriver => deriver.kind === 'projection');
    this.eventTypes = [...new Set(this.appliers.flatMap((applier) => applier.eventTypes))];
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
      const watermark = await this.actorResolution.findConfirmedDerivableBy(
        this.eventTypes,
        batchSize,
      );
      if (watermark.length === 0) {
        derivationMetrics.lagSeconds.record(0);
        return;
      }

      const oldest = watermark[0]!;
      const lagSeconds = computeLagSeconds(oldest.confirmed_at);
      derivationMetrics.lagSeconds.record(lagSeconds, { source_type: oldest.source_type });
      const settledRows = await this.filterSettledRows(watermark);
      if (settledRows.length === 0) return;

      const byDispatchKey = groupByDispatchKey(settledRows);
      for (const [dispatchKey, rows] of byDispatchKey) {
        const [sourceType, eventType] = parseDispatchKey(dispatchKey);
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

      const now = Date.now();
      if (now - this.lastProgressLogAt >= PROGRESS_LOG_INTERVAL_MS) {
        this.logger.log('derivation_progress', {
          batch: watermark.length,
          lag_s: Math.round(lagSeconds),
          dispatches: [...byDispatchKey.keys()],
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

  private async filterSettledRows(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<ArchiveDerivationRow[]> {
    const settled: ArchiveDerivationRow[] = [];
    const byChain = groupByChainId(rows);

    for (const [chainId, chainRows] of byChain) {
      const chainCtx = this.registry.peek(chainId);
      if (chainCtx === undefined) {
        this.logger.warn('derivation_settled_gate_chain_context_missing', { chain_id: chainId });
        continue;
      }

      try {
        const headHex = await chainCtx.client.send<string>('eth_blockNumber', []);
        const cutoff = BigInt(headHex) - BigInt(chainCtx.chainCfg.reorgHorizon) * 2n;
        const classify = makeCutoffClassifier(cutoff);
        for (const row of chainRows) {
          if (classify(BigInt(row.block_number)) === 'confirmed') {
            settled.push(row);
          }
        }
      } catch (error) {
        this.logger.warn('derivation_settled_gate_head_fetch_failed', {
          chain_id: chainId,
          error: String(error),
        });
      }
    }

    return settled;
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
}

function computeLagSeconds(confirmedAt: Date | null): number {
  if (confirmedAt === null) return 0;
  return Math.max(0, (Date.now() - confirmedAt.getTime()) / 1000);
}

function groupByDispatchKey(
  rows: readonly ArchiveDerivationRow[],
): Map<string, ArchiveDerivationRow[]> {
  const grouped = new Map<string, ArchiveDerivationRow[]>();
  for (const row of rows) {
    const key = `${row.source_type}:${row.event_type}`;
    const rowsForDispatch = grouped.get(key);
    if (rowsForDispatch === undefined) {
      grouped.set(key, [row]);
    } else {
      rowsForDispatch.push(row);
    }
  }
  return grouped;
}

function groupByChainId(
  rows: readonly ArchiveDerivationRow[],
): Map<string, ArchiveDerivationRow[]> {
  const grouped = new Map<string, ArchiveDerivationRow[]>();
  for (const row of rows) {
    const rowsForChain = grouped.get(row.chain_id);
    if (rowsForChain === undefined) {
      grouped.set(row.chain_id, [row]);
    } else {
      rowsForChain.push(row);
    }
  }
  return grouped;
}

function parseDispatchKey(dispatchKey: string): [string, string] {
  const separator = dispatchKey.lastIndexOf(':');
  if (separator <= 0 || separator >= dispatchKey.length - 1) {
    throw new Error(`invalid derivation dispatch key: ${dispatchKey}`);
  }
  return [dispatchKey.slice(0, separator), dispatchKey.slice(separator + 1)];
}

function readIntervalMs(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
