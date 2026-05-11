import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { ChEventData, ChEventRepositoryDeps } from './ch-event-repository.types';

export class ChEventRepository {
  private readonly chDb: Kysely<ClickHouseDatabase>;

  constructor(deps: ChEventRepositoryDeps) {
    this.chDb = deps.chDb;
  }

  async insert(data: ChEventData): Promise<void> {
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
}
