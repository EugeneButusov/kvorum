import { sql, type Kysely } from 'kysely';
import type { ArchiveDerivationRow, ClickHouseDatabase } from '@libs/db';
import type { ArchiveEventAragonVotingTable } from '../../persistence/schema';

export type AragonVotingArchivePayloadRow = Pick<
  ArchiveEventAragonVotingTable,
  'chain_id' | 'tx_hash' | 'log_index' | 'block_hash' | 'event_type' | 'payload' | 'received_at'
>;

/**
 * Loads decoded Aragon-voting archive payloads from ClickHouse, keyed on the EVM
 * 4-tuple (chain_id, tx_hash, log_index, block_hash). Consumers dedupe by
 * `received_at asc` (later rows win), matching the ReplacingMergeTree(received_at)
 * semantics without an explicit FINAL — mirrors the Aave governance payload repo.
 */
export class AragonVotingArchivePayloadRepository {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  async fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<AragonVotingArchivePayloadRow[]> {
    if (rows.length === 0) return [];

    const tuples = rows.map(
      (row) => sql`(${row.chain_id}, ${row.tx_hash}, ${row.log_index}, ${row.block_hash})`,
    );

    return this.chDb
      .selectFrom('archive_event_aragon_voting')
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
