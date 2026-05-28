import { sql, type Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';

type DelegationFlowProjectionTable = {
  dao_id: string;
  delegator_address: string;
  delegate_address: string;
  voting_power: string;
  block_number: string;
  log_index: number;
  event_type: 'delegate_changed' | 'votes_changed';
};

export type DelegationSnapshotEventRow = {
  event_type: 'delegate_changed' | 'votes_changed';
  voting_power: string;
  delegator_address: string;
  delegate_address: string;
};

export class CompTokenDelegationSnapshotRepository {
  constructor(private readonly ch: Kysely<ClickHouseDatabase>) {}

  async listForSnapshot(
    daoId: string,
    maxBlockNumber: string,
  ): Promise<DelegationSnapshotEventRow[]> {
    return this.ch
      .selectFrom(sql<DelegationFlowProjectionTable>`delegation_flow_projection`.as('d'))
      .select(['d.event_type', 'd.voting_power', 'd.delegator_address', 'd.delegate_address'])
      .where('d.dao_id', '=', daoId)
      .where('d.block_number', '<=', maxBlockNumber)
      .orderBy('d.block_number', 'asc')
      .orderBy('d.log_index', 'asc')
      .execute();
  }
}
