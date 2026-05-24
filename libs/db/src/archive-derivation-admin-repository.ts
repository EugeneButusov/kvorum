import type { Kysely } from 'kysely';
import type { PgDatabase } from './schema/pg';
export type { ArchiveDerivationRow } from './archive-derivation-repository';

export class ArchiveDerivationAdminRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  async countUnderived(daoSourceId: string, fromBlock?: bigint): Promise<number> {
    let query = this.pgDb
      .selectFrom('archive_event')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('dao_source_id', '=', daoSourceId);

    if (fromBlock != null) {
      query = query.where('block_number', '>=', fromBlock.toString());
    }

    const row = await query.executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async resetWatermarkForSource(daoSourceId: string, fromBlock?: bigint): Promise<number> {
    let query = this.pgDb
      .updateTable('archive_event')
      .set({ derived_at: null, derivation_attempt_count: 0 })
      .where('dao_source_id', '=', daoSourceId);

    if (fromBlock != null) {
      query = query.where('block_number', '>=', fromBlock.toString());
    }

    const result = await query.executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0n);
  }

  async resetWatermarkByConfirmationId(archiveConfirmationId: string): Promise<number> {
    const result = await this.pgDb
      .updateTable('archive_event')
      .set({ derived_at: null, derivation_attempt_count: 0 })
      .where('id', '=', archiveConfirmationId)
      .executeTakeFirst();

    return Number(result?.numUpdatedRows ?? 0n);
  }
}
