import { sql, type Kysely } from 'kysely';
import type { ClickHouseDatabase } from './schema/clickhouse';
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

interface CompoundArchiveTable {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  tx_hash: string;
  log_index: number;
  block_hash: string;
  event_type: string;
  payload: string;
  received_at: Date;
}

export type CompoundArchivePayloadRow = Pick<
  CompoundArchiveTable,
  'chain_id' | 'tx_hash' | 'log_index' | 'block_hash' | 'event_type' | 'payload' | 'received_at'
>;

interface ArchiveDerivationClickHouseDatabase extends ClickHouseDatabase {
  event_archive_compound_governor: CompoundArchiveTable;
}

export class ArchiveDerivationRepository {
  constructor(
    private readonly pgDb: Kysely<PgDatabase>,
    private readonly chDb: Kysely<ArchiveDerivationClickHouseDatabase>,
  ) {}

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

  async fetchCompoundPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<CompoundArchivePayloadRow[]> {
    if (rows.length === 0) return [];

    const tuples = rows.map(
      (row) => sql`(${row.chain_id}, ${row.tx_hash}, ${row.log_index}, ${row.block_hash})`,
    );

    return this.chDb
      .selectFrom(
        sql<CompoundArchiveTable>`event_archive_compound_governor FINAL`.as(
          'event_archive_compound_governor',
        ),
      )
      .select([
        'chain_id',
        'tx_hash',
        'log_index',
        'block_hash',
        'event_type',
        'payload',
        'received_at',
      ])
      .where(sql<boolean>`(chain_id, tx_hash, log_index, block_hash) IN (${sql.join(tuples)})`)
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
}
