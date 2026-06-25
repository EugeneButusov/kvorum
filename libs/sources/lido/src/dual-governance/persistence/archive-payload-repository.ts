import { sql, type Kysely } from 'kysely';
import type { ArchiveDerivationRow, ClickHouseDatabase } from '@libs/db';
import type { ArchiveEventDualGovernanceTable } from '../../persistence/schema';

export type DualGovernanceArchivePayloadRow = Pick<
  ArchiveEventDualGovernanceTable,
  'chain_id' | 'tx_hash' | 'log_index' | 'block_hash' | 'event_type' | 'payload' | 'received_at'
>;

/**
 * Loads decoded Dual Governance archive payloads from ClickHouse, keyed on the EVM 4-tuple
 * (chain_id, tx_hash, log_index, block_hash). Consumers dedupe by `received_at asc` (later rows win),
 * matching the ReplacingMergeTree(received_at) semantics without an explicit FINAL — mirrors the
 * Aragon-voting payload repo.
 */
export class DualGovernanceArchivePayloadRepository {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  async fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<DualGovernanceArchivePayloadRow[]> {
    if (rows.length === 0) return [];

    const tuples = rows.map(
      (row) => sql`(${row.chain_id}, ${row.tx_hash}, ${row.log_index}, ${row.block_hash})`,
    );

    return this.chDb
      .selectFrom('archive_event_dual_governance')
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
