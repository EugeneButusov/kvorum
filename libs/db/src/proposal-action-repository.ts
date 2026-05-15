import { sql, type Kysely, type Transaction } from 'kysely';
import type { PgDatabase } from './schema/pg';

/** Minimal projection returned by findPendingDecodeForUpdate. */
export interface PendingDecodeRow {
  id: string;
  proposal_id: string;
  target_address: string;
  target_chain_id: string;
  function_signature: string | null;
  calldata: string;
  decode_attempt_count: number;
}

export class ProposalActionRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /**
   * Selects up to `limit` pending rows and locks them via FOR UPDATE SKIP LOCKED.
   * Caller MUST wrap this call inside a transaction and complete the matching
   * markDecoded / markUndecodable call before committing, otherwise the lock is
   * released with no progress and another worker may pick the same row.
   */
  async findPendingDecodeForUpdate(
    trx: Transaction<PgDatabase>,
    limit: number,
  ): Promise<readonly PendingDecodeRow[]> {
    const result = await sql<PendingDecodeRow>`
      SELECT id, proposal_id, target_address, target_chain_id,
             function_signature, calldata, decode_attempt_count
      FROM proposal_action
      WHERE decode_status = 'pending'
        AND (next_decode_at IS NULL OR next_decode_at <= now())
      ORDER BY created_at ASC
      LIMIT ${sql.lit(limit)}
      FOR UPDATE SKIP LOCKED
    `.execute(trx);
    return result.rows;
  }

  async markDecoded(
    trx: Transaction<PgDatabase>,
    id: string,
    decoded: { function: string; arguments: unknown },
  ): Promise<void> {
    await trx
      .updateTable('proposal_action')
      .set({
        decoded_function: decoded.function,
        decoded_arguments: decoded.arguments as never,
        decode_status: 'decoded',
        decode_attempted_at: sql`now()`,
      })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Single-statement update for both 'partial' and 'miss' decode outcomes.
   * When functionSignatureGuess is provided, it is written via COALESCE so it
   * never overwrites a value the event already provided.
   * Enforces the 10-attempt cap (R9): at attempt 10 the row flips to
   * decode_status='undecodable' and next_decode_at is cleared.
   */
  async markUndecodable(
    trx: Transaction<PgDatabase>,
    id: string,
    args: { retryAt: Date; functionSignatureGuess?: string },
  ): Promise<void> {
    await trx
      .updateTable('proposal_action')
      .set({
        decode_attempted_at: sql`now()`,
        decode_attempt_count: sql`decode_attempt_count + 1`,
        function_signature: sql`COALESCE(function_signature, ${args.functionSignatureGuess ?? null})`,
        next_decode_at: sql`CASE WHEN decode_attempt_count + 1 >= 10 THEN NULL ELSE ${args.retryAt}::timestamptz END`,
        decode_status: sql`CASE WHEN decode_attempt_count + 1 >= 10 THEN 'undecodable'::decode_status ELSE 'pending'::decode_status END`,
      })
      .where('id', '=', id)
      .execute();
  }
}
