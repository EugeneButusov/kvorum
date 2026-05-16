import { sql, type Kysely } from 'kysely';
import type { PgDatabase } from './schema/pg';

export interface ArchiveDerivationRow {
  id: string;
  source_type: string;
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: string;
  confirmed_at: Date | null;
  derivation_attempt_count: number;
}

export class ArchiveDerivationRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  async findConfirmedUndderived(limit: number): Promise<ArchiveDerivationRow[]> {
    return this.pgDb
      .selectFrom('archive_confirmation')
      .select([
        'id',
        'source_type',
        'dao_source_id',
        'chain_id',
        'block_number',
        'block_hash',
        'tx_hash',
        'log_index',
        'event_type',
        'confirmed_at',
        'derivation_attempt_count',
      ])
      .where('confirmation_status', '=', 'confirmed')
      .where('derived_at', 'is', null)
      .orderBy('chain_id', 'asc')
      .orderBy('block_number', 'asc')
      .orderBy('log_index', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
  }

  async markDerived(id: string): Promise<void> {
    await this.pgDb
      .updateTable('archive_confirmation')
      .set({ derived_at: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  async incrementAttemptCount(id: string): Promise<void> {
    await this.pgDb
      .updateTable('archive_confirmation')
      .set({ derivation_attempt_count: sql`derivation_attempt_count + 1` })
      .where('id', '=', id)
      .execute();
  }

  async resetWatermarkForSource(daoSourceId: string, fromBlock?: bigint): Promise<number> {
    let query = this.pgDb
      .updateTable('archive_confirmation')
      .set({ derived_at: null, derivation_attempt_count: 0 })
      .where('dao_source_id', '=', daoSourceId)
      .where('confirmation_status', '=', 'confirmed');

    if (fromBlock != null) {
      query = query.where('block_number', '>=', fromBlock.toString());
    }

    const result = await query.executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0n);
  }
}
