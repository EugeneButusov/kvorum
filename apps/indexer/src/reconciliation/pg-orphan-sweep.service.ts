import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'kysely';
import {
  ArchiveEventRepository,
  chDb,
  DaoSourceRepository,
  DlqRepository,
  ReconciliationWatermarkRepository,
} from '@libs/db';
import type {
  EventArchiveCompoundCompTokenTable,
  EventArchiveCompoundGovernorBravoTable,
} from '@sources/compound';
import { reconciliationMetrics } from './reconciliation-metrics';

const SWEEP_NAME = 'pg_orphan';
const SWEEP_INTERVAL_MS = readIntervalMs('RECONCILIATION_SWEEP_INTERVAL_MS', 3_600_000);
const BATCH_SIZE = 500;
export const RECONCILIATION_PG_ORPHAN_STAGE = 'reconciliation_pg_orphan_stage';

type ChTupleHit = { chain_id: string; tx_hash: string; log_index: number };

@Injectable()
export class PgOrphanSweepService {
  private readonly logger = new Logger('PgOrphanSweep');
  private readonly inFlight = new Map<string, boolean>();

  constructor(
    private readonly daoSources: DaoSourceRepository,
    private readonly watermarkRepo: ReconciliationWatermarkRepository,
    private readonly archiveEvents: ArchiveEventRepository,
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
      const source = await this.daoSources.findActiveByIdWithChain(daoSourceId);
      if (source === undefined) return;

      const current = await this.watermarkRepo.find(SWEEP_NAME, daoSourceId);
      const cursor = {
        blockNumber: current?.blockNumber ?? BigInt(source.active_from_block ?? '0'),
        txHash: current?.txHash ?? '',
        logIndex: current?.logIndex ?? 0,
      };

      const batch = await this.archiveEvents.listByDaoSourceAfterCursor(
        daoSourceId,
        cursor,
        BATCH_SIZE,
      );
      if (batch.length === 0) return;

      const minBlock = BigInt(batch[0]!.block_number);
      const maxBlock = BigInt(batch[batch.length - 1]!.block_number);

      const hits = await this.readChHits(
        source.source_type,
        source.primary_chain_id,
        daoSourceId,
        minBlock,
        maxBlock,
        batch,
      );
      const hitSet = new Set(hits.map((row) => `${row.chain_id}:${row.tx_hash}:${row.log_index}`));

      for (const row of batch) {
        const key = `${row.chain_id}:${row.tx_hash}:${row.log_index}`;
        if (hitSet.has(key)) continue;

        await this.dlqRepo.insert({
          stage: RECONCILIATION_PG_ORPHAN_STAGE,
          source: 'indexer.reconciliation',
          payload: {
            reason: 'pg_orphan_missing_in_ch',
            dao_source_id: daoSourceId,
            chain_id: row.chain_id,
            tx_hash: row.tx_hash,
            log_index: row.log_index,
            block_hash: row.block_hash,
          },
          error: {
            message: 'Archive event exists in Postgres but is missing in ClickHouse',
          },
          retries: 0,
          first_seen_at: new Date(),
          last_attempt_at: new Date(),
          archive_source_type: row.source_type,
          archive_chain_id: row.chain_id,
          archive_tx_hash: row.tx_hash,
          archive_log_index: row.log_index,
          archive_block_hash: row.block_hash,
        });

        reconciliationMetrics.pgOrphanTotal.add(1, {
          result: 'routed_to_dlq',
          dao_source_id: daoSourceId,
        });
      }

      const last = batch[batch.length - 1]!;
      await this.watermarkRepo.upsert(SWEEP_NAME, daoSourceId, {
        blockNumber: BigInt(last.block_number),
        txHash: last.tx_hash,
        logIndex: last.log_index,
      });

      if (batch.length === BATCH_SIZE) {
        setImmediate(() => {
          void this.runOnce(daoSourceId);
        });
      }
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

  private async readChHits(
    sourceType: string,
    chainId: string,
    daoSourceId: string,
    minBlock: bigint,
    maxBlock: bigint,
    batch: Awaited<ReturnType<ArchiveEventRepository['listByDaoSourceAfterCursor']>>,
  ): Promise<ChTupleHit[]> {
    const table =
      sourceType === 'compound_comp_token'
        ? sql<EventArchiveCompoundCompTokenTable>`archive_event_compound_comp_token FINAL`
        : sql<EventArchiveCompoundGovernorBravoTable>`archive_event_compound_governor_bravo FINAL`;

    return chDb
      .selectFrom(table.as('a'))
      .select(['a.chain_id', 'a.tx_hash', 'a.log_index'])
      .where('a.chain_id', '=', chainId)
      .where('a.dao_source_id', '=', daoSourceId)
      .where(sql`toUInt64(a.block_number)`, '>=', Number(minBlock))
      .where(sql`toUInt64(a.block_number)`, '<=', Number(maxBlock))
      .where(({ eb, or }) =>
        or(
          batch.map((row) =>
            eb.and([
              eb('a.chain_id', '=', row.chain_id),
              eb('a.tx_hash', '=', row.tx_hash),
              eb('a.log_index', '=', row.log_index),
            ]),
          ),
        ),
      )
      .execute() as Promise<ChTupleHit[]>;
  }
}

function readIntervalMs(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
