import { sql, type Kysely } from 'kysely';
import type { ArchiveDerivationRow, ClickHouseDatabase } from '@libs/db';
import type { ArchiveEventSnapshotSplitDelegationTable } from '../../persistence/schema';

export type SplitDelegationArchivePayloadRow = Pick<
  ArchiveEventSnapshotSplitDelegationTable,
  'chain_id' | 'tx_hash' | 'log_index' | 'block_hash' | 'event_type' | 'payload' | 'received_at'
>;

export class SplitDelegationArchivePayloadRepository {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  async fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<SplitDelegationArchivePayloadRow[]> {
    if (rows.length === 0) return [];

    const tuples = rows.map(
      (row) => sql`(${row.chain_id}, ${row.tx_hash}, ${row.log_index}, ${row.block_hash})`,
    );

    return this.chDb
      .selectFrom('archive_event_snapshot_split_delegation')
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
      .orderBy('received_at', 'asc')
      .execute();
  }
}
