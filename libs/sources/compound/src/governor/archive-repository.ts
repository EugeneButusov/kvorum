import type { Kysely } from 'kysely';
import type { ClickHouseDatabase, NewArchiveConfirmation, PgDatabase } from '@libs/db';
import type { ArchiveKey, ArchiveRepositoryDeps, ChEventData } from './archive-repository.types';

export class ArchiveRepository {
  private readonly pgDb: Kysely<PgDatabase>;
  private readonly chDb: Kysely<ClickHouseDatabase>;

  constructor(deps: ArchiveRepositoryDeps) {
    this.pgDb = deps.pgDb;
    this.chDb = deps.chDb;
  }

  async findConfirmation(key: ArchiveKey): Promise<{ id: string } | undefined> {
    return this.pgDb
      .selectFrom('archive_confirmation')
      .select('id')
      .where('source_type', '=', key.sourceType)
      .where('chain_id', '=', key.chainId)
      .where('tx_hash', '=', key.txHash)
      .where('log_index', '=', key.logIndex)
      .where('block_hash', '=', key.blockHash)
      .executeTakeFirst();
  }

  async insertEvent(data: ChEventData): Promise<void> {
    await this.chDb
      .insertInto('event_archive_compound_governor')
      .values({
        dao_source_id: data.daoSourceId,
        chain_id: data.chainId,
        block_number: data.blockNumber,
        block_hash: data.blockHash,
        tx_hash: data.txHash,
        log_index: data.logIndex,
        event_type: data.eventType,
        payload: data.payload,
      } as Parameters<
        ReturnType<typeof this.chDb.insertInto<'event_archive_compound_governor'>>['values']
      >[0])
      .execute();
  }

  async insertConfirmation(row: NewArchiveConfirmation): Promise<{ id: string } | undefined> {
    return this.pgDb
      .insertInto('archive_confirmation')
      .values(row)
      .onConflict((oc) => oc.constraint('archive_confirmation_idempotency_key').doNothing())
      .returning('id')
      .executeTakeFirst();
  }
}
