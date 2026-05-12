import { sql, type Kysely } from 'kysely';
import type { NewReorgEvent, PgDatabase, ReorgEvent } from './schema/pg';

export interface OrphanResult {
  reorgEventId: string;
  orphanedRowCount: number;
}

export interface ReorgWriteInput {
  chainId: number;
  detectedAt: Date;
  divergenceBlockNumber: bigint;
  /** Already-filtered: nulls dropped by the caller. */
  orphanedBlockHashes: string[];
  /** Same length and order as orphanedBlockHashes; trailing nulls allowed for chain-shrunk reorgs. */
  canonicalBlockHashes: (string | null)[];
  /** Structured note captured by the watcher (truncated / chainShrunk flags). */
  notes: string | null;
}

export class ReorgEventRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  /** Single transaction: writes reorg_event, orphans matching pending rows.
   *  Returns the new reorg_event id and the count of rows transitioned to orphaned. */
  async writeReorgEventAndOrphan(input: ReorgWriteInput): Promise<OrphanResult> {
    return this.pgDb.transaction().execute(async (trx) => {
      const reorgRow: NewReorgEvent = {
        chain_id: input.chainId,
        detected_at: input.detectedAt,
        divergence_block_number: input.divergenceBlockNumber.toString(),
        orphaned_block_hashes: input.orphanedBlockHashes,
        canonical_block_hashes: input.canonicalBlockHashes as string[],
        notes: input.notes,
      };

      const { id: reorgEventId } = await trx
        .insertInto('reorg_event')
        .values(reorgRow)
        .returning('id')
        .executeTakeFirstOrThrow();

      if (input.orphanedBlockHashes.length === 0) {
        return { reorgEventId, orphanedRowCount: 0 };
      }

      const updateResult = await trx
        .updateTable('archive_confirmation')
        .set({
          confirmation_status: 'orphaned',
          orphaned_at: sql`now()`,
          orphaned_by_reorg_event_id: reorgEventId,
        })
        .where('chain_id', '=', input.chainId)
        .where('confirmation_status', '=', 'pending')
        .where('block_hash', 'in', input.orphanedBlockHashes)
        .executeTakeFirst();

      const orphanedRowCount = Number(updateResult?.numUpdatedRows ?? 0n);
      return { reorgEventId, orphanedRowCount };
    });
  }

  /** Read API used by Epic I's `admin-cli reorg list`. */
  async listRecent(chainId: number, limit = 50): Promise<ReorgEvent[]> {
    return this.pgDb
      .selectFrom('reorg_event')
      .selectAll()
      .where('chain_id', '=', chainId)
      .orderBy('detected_at', 'desc')
      .limit(limit)
      .execute();
  }
}
