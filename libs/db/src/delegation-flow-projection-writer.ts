import type { Generated, Kysely } from 'kysely';
import type { ClickHouseDatabase } from './schema/clickhouse';

export const ZERO_DELEGATE_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface NewDelegationFlowProjectionRow {
  delegation_id: string;
  dao_id: string;
  delegator_address: string;
  delegate_address: string;
  voting_power: string;
  block_number: string;
  log_index: number;
  event_type: string;
  created_at: Date;
}

type DelegationFlowProjectionTable = {
  delegation_id: string;
  dao_id: string;
  delegator_address: string;
  delegate_address: string;
  voting_power: string;
  block_number: string;
  log_index: number;
  event_type: string;
  created_at: Date;
  version: Generated<Date>;
};

type DelegationFlowFlatDatabase = ClickHouseDatabase & {
  delegation_flow_projection: DelegationFlowProjectionTable;
};

export class DelegationFlowProjectionWriter {
  constructor(private readonly chDb: Kysely<DelegationFlowFlatDatabase>) {}

  async insertBatch(rows: readonly NewDelegationFlowProjectionRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.chDb
      .insertInto('delegation_flow_projection')
      .values([...rows])
      .execute();
  }
}
