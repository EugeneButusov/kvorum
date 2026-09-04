import { sql, type Kysely } from 'kysely';
import type { ClickHouseDatabase } from './schema/clickhouse';

export class DelegateDiscoveryRepository {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  async findKnownDelegateAddresses(daoId: string): Promise<string[]> {
    const rows = await this.chDb
      .selectFrom(
        sql<{ delegate_address: string }>`(
          SELECT DISTINCT toString(delegate_address) AS delegate_address
          FROM delegation_flow_projection
          WHERE dao_id = ${daoId}
            AND event_type = 'delegate_changed'
            AND delegate_address != '0x0000000000000000000000000000000000000000'
        )`.as('t'),
      )
      .selectAll()
      .execute();

    return rows.map((r) => r.delegate_address);
  }
}
