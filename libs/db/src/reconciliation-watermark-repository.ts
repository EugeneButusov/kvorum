import type { Kysely } from 'kysely';
import type { PgDatabase } from './schema/pg';

export interface ReconciliationCursor {
  blockNumber: bigint;
  txHash?: string;
  logIndex?: number;
}

export interface ReconciliationWatermarkRow {
  sweepName: string;
  daoSourceId: string;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
  lastSweepAt: Date | null;
}

export class ReconciliationWatermarkRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async find(
    sweepName: string,
    daoSourceId: string,
  ): Promise<ReconciliationWatermarkRow | undefined> {
    const row = await this.db
      .selectFrom('reconciliation_watermark')
      .selectAll()
      .where('sweep_name', '=', sweepName)
      .where('dao_source_id', '=', daoSourceId)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    return {
      sweepName: row.sweep_name,
      daoSourceId: row.dao_source_id,
      blockNumber: BigInt(row.last_swept_block_number),
      txHash: row.last_swept_tx_hash,
      logIndex: row.last_swept_log_index,
      lastSweepAt: row.last_sweep_at,
    };
  }

  async findAll(sweepName: string): Promise<ReconciliationWatermarkRow[]> {
    const rows = await this.db
      .selectFrom('reconciliation_watermark')
      .selectAll()
      .where('sweep_name', '=', sweepName)
      .execute();
    return rows.map((row) => ({
      sweepName: row.sweep_name,
      daoSourceId: row.dao_source_id,
      blockNumber: BigInt(row.last_swept_block_number),
      txHash: row.last_swept_tx_hash,
      logIndex: row.last_swept_log_index,
      lastSweepAt: row.last_sweep_at,
    }));
  }

  async upsert(
    sweepName: string,
    daoSourceId: string,
    cursor: ReconciliationCursor,
  ): Promise<void> {
    await this.db
      .insertInto('reconciliation_watermark')
      .values({
        sweep_name: sweepName,
        dao_source_id: daoSourceId,
        last_swept_block_number: cursor.blockNumber.toString(),
        last_swept_tx_hash: cursor.txHash ?? '',
        last_swept_log_index: cursor.logIndex ?? 0,
        last_sweep_at: new Date(),
      })
      .onConflict((oc) =>
        oc.columns(['sweep_name', 'dao_source_id']).doUpdateSet({
          last_swept_block_number: cursor.blockNumber.toString(),
          last_swept_tx_hash: cursor.txHash ?? '',
          last_swept_log_index: cursor.logIndex ?? 0,
          last_sweep_at: new Date(),
        }),
      )
      .execute();
  }
}
