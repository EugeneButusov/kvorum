import type { Kysely, Transaction } from 'kysely';
import type { NewDelegation, PgDatabase } from './schema/pg';

export interface DelegationSnapshotEventRow {
  event_type: 'delegate_changed' | 'votes_changed';
  delegator_actor_id: string;
  delegate_actor_id: string | null;
  voting_power: string;
}

export class DelegationRepository {
  constructor(private readonly db: Kysely<PgDatabase> | Transaction<PgDatabase>) {}

  async insert(row: NewDelegation): Promise<void> {
    await this.db.insertInto('delegation').values(row).execute();
  }

  async listForSnapshot(
    daoId: string,
    maxBlockNumber: string,
  ): Promise<DelegationSnapshotEventRow[]> {
    return this.db
      .selectFrom('delegation')
      .select(['event_type', 'delegator_actor_id', 'delegate_actor_id', 'voting_power'])
      .where('dao_id', '=', daoId)
      .where('block_number', '<=', maxBlockNumber)
      .orderBy('block_number', 'asc')
      .orderBy('tx_index', 'asc')
      .orderBy('log_index', 'asc')
      .execute() as Promise<DelegationSnapshotEventRow[]>;
  }
}
