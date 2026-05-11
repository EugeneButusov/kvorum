import type { Kysely } from 'kysely';
import type { NewArchiveConfirmation, PgDatabase } from './schema/pg';

export interface ConfirmationKey {
  sourceType: string;
  chainId: number;
  txHash: string;
  logIndex: number;
  blockHash: string;
}

export class ConfirmationRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  async find(key: ConfirmationKey): Promise<{ id: string } | undefined> {
    return this.pgDb
      .selectFrom('archive_confirmation')
      .select('id')
      .where('source_type', '=', key.sourceType)
      .where('chain_id', '=', key.chainId)
      .where('tx_hash', '=', key.txHash)
      .where('log_index', '=', key.logIndex)
      .where('block_hash', '=', key.blockHash)
      .executeTakeFirst();
  }

  async insert(row: NewArchiveConfirmation): Promise<{ id: string } | undefined> {
    return this.pgDb
      .insertInto('archive_confirmation')
      .values(row)
      .onConflict((oc) => oc.constraint('archive_confirmation_idempotency_key').doNothing())
      .returning('id')
      .executeTakeFirst();
  }
}
