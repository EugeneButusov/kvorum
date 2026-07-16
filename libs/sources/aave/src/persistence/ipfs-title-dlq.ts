import type { Kysely } from 'kysely';
import type { ArchiveDerivationRow, PgDatabase } from '@libs/db';

/** Stage both Aave governors park an un-enriched proposal title under (see the *-projection-applier). */
export const AAVE_IPFS_TITLE_FETCH_STAGE = 'aave_ipfs_title_fetch';

/**
 * Parks a freshly-derived Aave proposal for out-of-band IPFS title enrichment.
 *
 * Idempotent by necessity: this INSERT runs inside the same transaction that creates the proposal
 * and marks the archive row derived. A plain INSERT throws on
 * `idx_ingestion_dlq_archive_tuple_stage` whenever a DLQ row for this (archive tuple, stage) already
 * exists — which rolls the whole transaction back, so the proposal is never created and the row is
 * never marked. The derivation worker then re-picks the same block-ordered row forever and every
 * event behind it stalls permanently. A single stale DLQ row (e.g. archive_event/proposal wiped for
 * a re-backfill while ingestion_dlq was left intact) is enough to wedge the entire pipeline.
 *
 * On conflict we reuse the existing entry's id rather than failing: the caller only needs an id to
 * hand to post-commit enrichment, and re-parking an already-parked proposal is a no-op by intent.
 * The index is partial (`WHERE archive_source_type IS NOT NULL`), so we use an untargeted
 * `ON CONFLICT DO NOTHING` and look the row up rather than relying on index inference.
 */
export async function insertIpfsTitleDlq(
  tx: Kysely<PgDatabase>,
  row: ArchiveDerivationRow,
  opts: { proposalId: string; descriptionHash: string; source: string },
): Promise<string> {
  const inserted = await tx
    .insertInto('ingestion_dlq')
    .values({
      stage: AAVE_IPFS_TITLE_FETCH_STAGE,
      source: opts.source,
      payload: {
        proposal_id: opts.proposalId,
        ipfs_hash: opts.descriptionHash,
        dao_source_id: row.dao_source_id,
      },
      error: { message: 'awaiting ipfs title fetch' },
      retries: 0,
      first_seen_at: new Date(),
      last_attempt_at: new Date(),
      archive_source_type: row.source_type,
      archive_chain_id: row.chain_id,
      archive_tx_hash: row.tx_hash,
      archive_log_index: row.log_index,
      archive_block_hash: row.block_hash,
    })
    .onConflict((oc) => oc.doNothing())
    .returning('id')
    .executeTakeFirst();

  if (inserted !== undefined) return inserted.id;

  // DO NOTHING returned no row → an entry for this (archive tuple, stage) is already parked.
  const existing = await tx
    .selectFrom('ingestion_dlq')
    .select('id')
    .where('archive_source_type', '=', row.source_type)
    .where('archive_chain_id', '=', row.chain_id)
    .where('archive_tx_hash', '=', row.tx_hash)
    .where('archive_log_index', '=', row.log_index)
    .where('archive_block_hash', '=', row.block_hash)
    .where('stage', '=', AAVE_IPFS_TITLE_FETCH_STAGE)
    .executeTakeFirstOrThrow();

  return existing.id;
}
