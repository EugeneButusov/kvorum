import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'kysely';
import { ChainContextRegistry, parseChainConfigFromEnv, readConfirmedHead } from '@libs/chain';
import {
  ArchiveEventRepository,
  chDb,
  DaoSourceRepository,
  ReconciliationWatermarkRepository,
} from '@libs/db';
import type {
  EventArchiveCompoundCompTokenTable,
  EventArchiveCompoundGovernorBravoTable,
} from '@sources/compound';
import { reconciliationMetrics } from './reconciliation-metrics';

const SWEEP_NAME = 'ch_orphan';
const SWEEP_INTERVAL_MS = readIntervalMs('RECONCILIATION_SWEEP_INTERVAL_MS', 3_600_000);
const SAFETY_MARGIN_BLOCKS = BigInt(
  Number(process.env['RECONCILIATION_CH_ORPHAN_SAFETY_MARGIN_BLOCKS'] ?? '5'),
);
const INSERT_BATCH_SIZE = 500;

type ChArchiveRow = {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: string;
};

@Injectable()
export class ChOrphanSweepService {
  private readonly logger = new Logger('ChOrphanSweep');
  private readonly inFlight = new Map<string, boolean>();

  constructor(
    private readonly daoSources: DaoSourceRepository,
    private readonly archiveEvents: ArchiveEventRepository,
    private readonly watermarkRepo: ReconciliationWatermarkRepository,
    private readonly chainRegistry: ChainContextRegistry,
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
      if (sources.length === 0 || this.knownEventTypes.length === 0) return;

      const chainCfg = parseChainConfigFromEnv(process.env).find((c) => c.chainId === chainId);
      if (chainCfg === undefined)
        throw new Error(`missing CHAIN_CONFIG entry for chain ${chainId}`);
      const chainCtx = await this.chainRegistry.getOrCreate(chainCfg);
      const confirmedHead = await readConfirmedHead(chainCtx.client, chainCfg, 'reconciliation');
      const upper =
        confirmedHead > SAFETY_MARGIN_BLOCKS ? confirmedHead - SAFETY_MARGIN_BLOCKS : 0n;

      const sourceById = new Map(sources.map((s) => [s.id, s]));
      const sourceWm = new Map<string, bigint>();
      for (const source of sources) {
        const current = await this.watermarkRepo.find(SWEEP_NAME, source.id);
        const floor = current?.blockNumber ?? BigInt(source.active_from_block ?? '0');
        sourceWm.set(source.id, floor);
        reconciliationMetrics.watermarkLagBlocks.record(Number(upper - floor), {
          sweep: SWEEP_NAME,
          dao_source_id: source.id,
        });
      }

      const lowestWm = [...sourceWm.values()].reduce((acc, v) => (v < acc ? v : acc), upper);
      if (upper <= lowestWm) return;

      const rows = await this.readCombinedChRows(chainId, [...sourceById.keys()], lowestWm, upper);
      const deduped = dedupeByTuple(rows);

      for (const source of sources) {
        const floor = sourceWm.get(source.id) ?? 0n;
        const sourceRows = deduped.filter(
          (row) => row.dao_source_id === source.id && BigInt(row.block_number) > floor,
        );

        for (let i = 0; i < sourceRows.length; i += INSERT_BATCH_SIZE) {
          const batch = sourceRows.slice(i, i + INSERT_BATCH_SIZE);
          const tuples = batch.map((row) => ({
            chainId: row.chain_id,
            txHash: row.tx_hash,
            logIndex: row.log_index,
          }));
          const existing = await this.archiveEvents.findExistingTuples(source.source_type, tuples);

          for (const row of batch) {
            const key = `${row.chain_id}:${row.tx_hash}:${row.log_index}`;
            if (existing.has(key)) continue;
            await this.archiveEvents.insert({
              source_type: source.source_type,
              dao_source_id: source.id,
              chain_id: row.chain_id,
              block_number: row.block_number,
              block_hash: row.block_hash,
              tx_hash: row.tx_hash,
              log_index: row.log_index,
              event_type: row.event_type,
              received_at: new Date(),
              derived_at: null,
              derivation_actor_resolved_at: null,
            });
            reconciliationMetrics.chOrphanTotal.add(1, {
              result: 'recovered',
              dao_source_id: source.id,
            });
          }
        }

        await this.watermarkRepo.upsert(SWEEP_NAME, source.id, { blockNumber: upper });
      }
    } catch (err) {
      this.logger.error('ch_orphan_tick_failed', { error: String(err), chain_id: chainId });
      reconciliationMetrics.chOrphanTotal.add(1, { result: 'error', dao_source_id: chainId });
    } finally {
      reconciliationMetrics.sweepDurationSeconds.record((Date.now() - startedAt) / 1000, {
        sweep: SWEEP_NAME,
        dao_source_id: chainId,
      });
      this.inFlight.set(chainId, false);
    }
  }

  private async readCombinedChRows(
    chainId: string,
    daoSourceIds: string[],
    lowestWm: bigint,
    upper: bigint,
  ): Promise<ChArchiveRow[]> {
    const governorRows = await chDb
      .selectFrom(
        sql<EventArchiveCompoundGovernorBravoTable>`archive_event_compound_governor_bravo`.as('a'),
      )
      .select([
        'a.dao_source_id',
        'a.chain_id',
        'a.block_number',
        'a.block_hash',
        'a.tx_hash',
        'a.log_index',
        'a.event_type',
      ])
      .where('a.chain_id', '=', chainId)
      .where('a.dao_source_id', 'in', daoSourceIds)
      .where(sql`toUInt64(a.block_number)`, '>', Number(lowestWm))
      .where(sql`toUInt64(a.block_number)`, '<=', Number(upper))
      .where('a.event_type', 'in', this.knownEventTypes)
      .execute();

    const tokenRows = await chDb
      .selectFrom(
        sql<EventArchiveCompoundCompTokenTable>`archive_event_compound_comp_token`.as('a'),
      )
      .select([
        'a.dao_source_id',
        'a.chain_id',
        'a.block_number',
        'a.block_hash',
        'a.tx_hash',
        'a.log_index',
        'a.event_type',
      ])
      .where('a.chain_id', '=', chainId)
      .where('a.dao_source_id', 'in', daoSourceIds)
      .where(sql`toUInt64(a.block_number)`, '>', Number(lowestWm))
      .where(sql`toUInt64(a.block_number)`, '<=', Number(upper))
      .where('a.event_type', 'in', this.knownEventTypes)
      .execute();

    return [...(governorRows as ChArchiveRow[]), ...(tokenRows as ChArchiveRow[])];
  }
}

function dedupeByTuple(rows: readonly ChArchiveRow[]): ChArchiveRow[] {
  const out = new Map<string, ChArchiveRow>();
  for (const row of rows) {
    out.set(`${row.dao_source_id}:${row.chain_id}:${row.tx_hash}:${row.log_index}`, row);
  }
  return [...out.values()];
}

function readIntervalMs(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
