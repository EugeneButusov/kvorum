import type { Kysely } from 'kysely';
import type { ClickHouseDatabase } from '@libs/db';

/**
 * Resolves the Aragon enactment that a DG/Timelock submission rode in on (ADR-0074 §4). There is no
 * on-chain field linking a DG proposal to its Aragon vote, but the Aragon enactment script calls
 * `submitProposal` synchronously, so the Aragon `ExecuteVote` and the Timelock `ProposalSubmitted`
 * share the enactment transaction — verified on real mainnet submissions (VERIFICATION.md). This reads
 * the Aragon-voting sub-source's archive (intra-`libs/sources/lido` coupling — both are Lido).
 *
 * Dedupe matches the Aragon/DG payload repos: order by `received_at asc`, last row wins (the
 * ReplacingMergeTree(received_at) semantics) — no explicit FINAL.
 */
export class AragonEnactmentLookup {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  /** The voteId of the Aragon `ExecuteVote` in this tx, or undefined when none (→ a direct submission). */
  async findEnactmentVoteId(chainId: string, txHash: string): Promise<string | undefined> {
    const rows = await this.chDb
      .selectFrom('archive_event_aragon_voting')
      .select(['payload', 'received_at'])
      .where('chain_id', '=', chainId)
      .where('tx_hash', '=', txHash)
      .where('event_type', '=', 'ExecuteVote')
      .orderBy('received_at', 'asc')
      .execute();

    const last = rows.at(-1);
    if (last === undefined) return undefined;
    const parsed = JSON.parse(last.payload) as { voteId?: string };
    return parsed.voteId;
  }

  /**
   * Coverage gate for the cross-source defer (ADR-0074 §4): the highest block the Aragon-voting archive
   * has reached. If this is `>= dgBlock`, the Aragon ingester has passed the DG submission's block, so a
   * co-tx `ExecuteVote` (same block) is guaranteed present if one exists — absence then means a genuine
   * direct submission. If it is `< dgBlock` (or null), the applier defers rather than mis-classify.
   */
  async maxArchivedBlock(chainId: string): Promise<bigint | undefined> {
    const row = await this.chDb
      .selectFrom('archive_event_aragon_voting')
      .select((eb) => eb.fn.max('block_number').as('max_block'))
      .where('chain_id', '=', chainId)
      .executeTakeFirst();

    const max = row?.max_block;
    return max === undefined || max === null ? undefined : BigInt(max);
  }
}
