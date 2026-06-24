import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';
import type {
  DualGovernanceEventData,
  DualGovernanceEventRepositoryDeps,
} from './event-repository.types';

export class DualGovernanceEventRepository {
  private readonly chDb: Kysely<ClickHouseDatabase>;

  constructor(deps: DualGovernanceEventRepositoryDeps) {
    this.chDb = deps.chDb;
  }

  async insert(data: DualGovernanceEventData): Promise<void> {
    await this.chDb
      .insertInto('archive_event_dual_governance')
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
        ReturnType<typeof this.chDb.insertInto<'archive_event_dual_governance'>>['values']
      >[0])
      .execute();
  }
}
