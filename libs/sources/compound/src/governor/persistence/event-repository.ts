import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type { GovernorEventData, GovernorEventRepositoryDeps } from './event-repository.types';

export class GovernorEventRepository {
  private readonly chDb: Kysely<ClickHouseDatabase>;

  constructor(deps: GovernorEventRepositoryDeps) {
    this.chDb = deps.chDb;
  }

  async insert(data: GovernorEventData): Promise<void> {
    await this.chDb
      .insertInto('event_archive_compound_governor_bravo')
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
        ReturnType<typeof this.chDb.insertInto<'event_archive_compound_governor_bravo'>>['values']
      >[0])
      .execute();
  }
}
