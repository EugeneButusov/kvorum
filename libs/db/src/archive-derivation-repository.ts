import { sql, type Kysely } from 'kysely';
import type { ArchiveEventType } from '@libs/domain';
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
  event_type: ArchiveEventType;
  received_at: Date;
  derivation_attempt_count: number;
}

export class ArchiveDerivationRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  async findUnderived(
    eventTypes: readonly ArchiveEventType[],
    limit: number,
  ): Promise<ArchiveDerivationRow[]> {
    if (eventTypes.length === 0) return [];

    return this.pgDb
      .selectFrom('archive_event')
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
        'received_at',
        'derivation_attempt_count',
      ])
      .where('derived_at', 'is', null)
      .where('event_type', 'in', eventTypes)
      .orderBy('chain_id', 'asc')
      .orderBy('block_number', 'asc')
      .orderBy('log_index', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
  }

  async markDerived(id: string): Promise<void> {
    await this.pgDb
      .updateTable('archive_event')
      .set({ derived_at: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  async incrementAttemptCount(id: string): Promise<void> {
    await this.pgDb
      .updateTable('archive_event')
      .set({ derivation_attempt_count: sql`derivation_attempt_count + 1` })
      .where('id', '=', id)
      .execute();
  }
}
