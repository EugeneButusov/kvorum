import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type {
  AaveGovernorV2EventData,
  AaveGovernorV2EventRepositoryDeps,
} from './event-repository.types';

export class AaveGovernorV2EventRepository {
  private readonly chDb: Kysely<ClickHouseDatabase>;

  constructor(deps: AaveGovernorV2EventRepositoryDeps) {
    this.chDb = deps.chDb;
  }

  async insert(data: AaveGovernorV2EventData): Promise<void> {
    await this.chDb
      .insertInto('archive_event_aave_governor_v2')
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
        ReturnType<typeof this.chDb.insertInto<'archive_event_aave_governor_v2'>>['values']
      >[0])
      .execute();
  }
}
