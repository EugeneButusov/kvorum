import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from './schema/clickhouse';

const BULK_INSERT_CHUNK_SIZE = 1000;

export interface NewVotingPowerSnapshotProjectionRow {
  dao_id: string;
  proposal_id: string;
  actor_address: string;
  voter_address: string;
  voting_power: string;
  actor_id_hint: string | null;
  computed_at: Date;
}

export class VotingPowerSnapshotProjectionWriter {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  async bulkInsert(rows: readonly NewVotingPowerSnapshotProjectionRow[]): Promise<number> {
    if (rows.length === 0) return 0;

    let inserted = 0;
    for (let offset = 0; offset < rows.length; offset += BULK_INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + BULK_INSERT_CHUNK_SIZE);
      await this.chDb
        .insertInto('voting_power_snapshot_raw')
        .values([...chunk])
        .execute();
      inserted += chunk.length;
    }

    return inserted;
  }
}
