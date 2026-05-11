import type { Kysely } from 'kysely';
import type { NewArchiveConfirmation, PgDatabase } from './schema/pg';

export interface ConfirmationKey {
  sourceType: string;
  chainId: number;
  txHash: string;
  logIndex: number;
  blockHash: string;
}

const DEFAULT_RETRY_BACKOFF_MS = [200, 600, 1800] as const;

const TRANSIENT_SQLSTATES = new Set([
  '08000',
  '08001',
  '08003',
  '08006',
  '08007', // connection-level
  '57P01',
  '57P02',
  '57P03', // admin/shutdown
  '40001',
  '40P01', // serialization
  '53300', // too_many_connections
  '08004', // server_rejected_establishment
]);

const TRANSIENT_NODE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']);

export function isTransientError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const code = typeof e['code'] === 'string' ? e['code'] : '';
  return TRANSIENT_SQLSTATES.has(code) || TRANSIENT_NODE_CODES.has(code);
}

export class ConfirmationRepository {
  private readonly retryBackoffMs: readonly number[];

  constructor(
    private readonly pgDb: Kysely<PgDatabase>,
    retryBackoffMs: readonly number[] = DEFAULT_RETRY_BACKOFF_MS,
  ) {
    this.retryBackoffMs = retryBackoffMs;
  }

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
    for (let attempt = 0; attempt <= this.retryBackoffMs.length; attempt++) {
      try {
        return await this.pgDb
          .insertInto('archive_confirmation')
          .values(row)
          .onConflict((oc) => oc.constraint('archive_confirmation_idempotency_key').doNothing())
          .returning('id')
          .executeTakeFirst();
      } catch (err) {
        if (isTransientError(err) && attempt < this.retryBackoffMs.length) {
          await new Promise((resolve) => setTimeout(resolve, this.retryBackoffMs[attempt]));
          continue;
        }
        throw err;
      }
    }
    throw new Error('retry loop exhausted without return');
  }
}
