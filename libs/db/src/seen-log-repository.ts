import type { Kysely, Transaction } from 'kysely';
import type { PgDatabase } from './schema/pg';
import type { NewSeenLog } from './schema/seen-log';

export class SeenLogRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  /**
   * Insert the coordinate inside the caller's transaction. Returns true iff a NEW row was
   * recorded — the gate for enqueueing the archive_ch job (G2: exactly-once-into-queue).
   */
  async recordIfNew(trx: Transaction<PgDatabase>, coord: NewSeenLog): Promise<boolean> {
    const row = await trx
      .insertInto('seen_log')
      .values(coord)
      .onConflict((oc) => oc.columns(['chain_id', 'tx_hash', 'log_index']).doNothing())
      .returning('tx_hash')
      .executeTakeFirst();
    return row !== undefined;
  }

  /** Block-height prune (G3). Returns number of rows deleted. */
  async pruneBelow(chainId: string, horizonBlock: bigint): Promise<number> {
    const res = await this.pgDb
      .deleteFrom('seen_log')
      .where('chain_id', '=', chainId)
      .where('block_number', '<', horizonBlock.toString())
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0n);
  }
}
