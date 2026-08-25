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
  source_type: string;
}

/** Scope for re-queuing already-attempted decode rows. */
export interface RedecodeFilter {
  /** Restrict to these DAO slugs (joins proposal → dao). Empty/undefined ⇒ all DAOs. */
  daoSlugs?: readonly string[];
  /** Restrict to these proposal source types. Empty/undefined ⇒ all source types. */
  sourceTypes?: readonly string[];
  /** Include terminal `undecodable` rows (10 attempts exhausted). Default true. */
  includeUndecodable?: boolean;
  /** Also include `pending` rows still counting down `next_decode_at` (clears their backoff). Default false. */
  includePending?: boolean;
}

export class ProposalActionRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  /** Resolve the decode_status values a RedecodeFilter targets (never includes 'decoded'). */
  private redecodeStatuses(filter: RedecodeFilter): ('undecodable' | 'pending')[] {
    const statuses: ('undecodable' | 'pending')[] = [];
    if (filter.includeUndecodable ?? true) statuses.push('undecodable');
    if (filter.includePending ?? false) statuses.push('pending');
    return statuses;
  }

  /** Subquery selecting proposal_action ids matching the filter's status + dao/source scope. */
  private scopedActionIds(filter: RedecodeFilter, statuses: ('undecodable' | 'pending')[]) {
    let q = this.db
      .selectFrom('proposal_action as pa')
      .innerJoin('proposal as p', 'p.id', 'pa.proposal_id')
      .select('pa.id')
      .where('pa.decode_status', 'in', statuses);
    if (filter.sourceTypes && filter.sourceTypes.length > 0) {
      q = q.where('p.source_type', 'in', filter.sourceTypes as never[]);
    }
    if (filter.daoSlugs && filter.daoSlugs.length > 0) {
      q = q.innerJoin('dao as d', 'd.id', 'p.dao_id').where('d.slug', 'in', filter.daoSlugs);
    }
    return q;
  }

  /** Count rows a resetForRedecode call would affect (for --dry-run). */
  async countForRedecode(filter: RedecodeFilter): Promise<number> {
    const statuses = this.redecodeStatuses(filter);
    if (statuses.length === 0) return 0;
    const row = await this.scopedActionIds(filter, statuses)
      .clearSelect()
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  /**
   * Re-queue already-attempted decode rows so the indexer sweep re-processes them: resets
   * decode_status to 'pending', zeroes the attempt counter, and clears next_decode_at. This does
   * NOT decode anything — the running CalldataDecoderWorkerService does the work. Returns the number
   * of rows re-queued.
   */
  async resetForRedecode(filter: RedecodeFilter): Promise<number> {
    const statuses = this.redecodeStatuses(filter);
    if (statuses.length === 0) return 0;
    const result = await this.db
      .updateTable('proposal_action')
      .set({
        decode_status: 'pending',
        decode_attempt_count: 0,
        next_decode_at: null,
      })
      .where('id', 'in', this.scopedActionIds(filter, statuses))
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

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
      SELECT pa.id, pa.proposal_id, pa.target_address, pa.target_chain_id,
             pa.function_signature, pa.calldata, pa.decode_attempt_count,
             p.source_type
      FROM proposal_action pa
      JOIN proposal p ON p.id = pa.proposal_id
      WHERE pa.decode_status = 'pending'
        AND (pa.next_decode_at IS NULL OR pa.next_decode_at <= now())
      ORDER BY pa.created_at ASC
      LIMIT ${sql.lit(limit)}
      FOR UPDATE OF pa SKIP LOCKED
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
