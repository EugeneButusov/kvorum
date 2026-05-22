import { sql, type Kysely } from 'kysely';
import type { ArchiveDerivationRow, ClickHouseDatabase } from '@libs/db';
import type { EventArchiveCompoundGovernorBravoTable } from './schema';

export type GovernorArchivePayloadRow = Pick<
  EventArchiveCompoundGovernorBravoTable,
  'chain_id' | 'tx_hash' | 'log_index' | 'block_hash' | 'event_type' | 'payload' | 'received_at'
>;

export class GovernorArchivePayloadRepository {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  async fetchPayloads(rows: readonly ArchiveDerivationRow[]): Promise<GovernorArchivePayloadRow[]> {
    if (rows.length === 0) return [];

    const tuples = rows.map(
      (row) => sql`(${row.chain_id}, ${row.tx_hash}, ${row.log_index}, ${row.block_hash})`,
    );

    return this.chDb
      .selectFrom('event_archive_compound_governor_bravo')
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

  async findByProposalId(
    daoSourceId: string,
    proposalId: string,
  ): Promise<GovernorArchivePayloadRow[]> {
    return this.chDb
      .selectFrom('event_archive_compound_governor_bravo')
      .select([
        'chain_id',
        'tx_hash',
        'log_index',
        'block_hash',
        'event_type',
        'payload',
        'received_at',
      ])
      .where('dao_source_id', '=', daoSourceId)
      .where(sql<boolean>`JSONExtractString(payload, 'proposalId') = ${proposalId}`)
      .orderBy('received_at', 'asc')
      .execute();
  }
}
