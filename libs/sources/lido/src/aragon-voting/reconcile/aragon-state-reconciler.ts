import type { Logger } from '@libs/chain';
import { ProposalRepository } from '@libs/db';
import type { ReconcileOutcome, ReconcileRpcClient, StateReconciler } from '@sources/core';
import { toProposalActions } from '../../calldata/evmscript-actions';
import { decodeGetVote, encodeGetVote } from '../abi/get-vote';
import type {
  AragonProposalRepository,
  AragonStaleReconciliationRow,
} from '../persistence/aragon-proposal-repository';

const PCT_BASE = 10n ** 18n;

/**
 * getVote-driven reconcile + enrichment for Lido Aragon votes.
 *
 * One `getVote` read per candidate at the confirmed-threshold block:
 *  - **enrich** (once, when `support_required_pct IS NULL`): decode the script →
 *    `proposal_action` rows, then fill support/quorum pct (pct written LAST so it
 *    is the reliable enrich-once signal; a partial failure self-heals on re-query
 *    since the pct stays NULL and `insertActions` is idempotent).
 *  - **classify**: `open` → still active; closed + !executed → event-silent
 *    `succeeded`/`defeated`; on-chain `executed` while local ≠ executed →
 *    `missed_event` (surfaced, never overwritten — execution arrives via the event).
 *
 * Phase-end-times are a follow-up (they need per-vote-era config). The close
 * `state_updated_at` uses the confirmed-threshold block timestamp (deterministic,
 * replay-safe) rather than the exact `startDate + voteTime` (deferred with phases).
 */
export class AragonStateReconciler implements StateReconciler<AragonStaleReconciliationRow> {
  constructor(
    private readonly logger: Logger,
    readonly sourceTypes: readonly string[],
    private readonly proposalRepo: ProposalRepository,
  ) {}

  async reconcileRow(args: {
    row: AragonStaleReconciliationRow;
    proposals: AragonProposalRepository;
    confirmedThreshold: bigint;
    confirmedThresholdTag: string;
    chainCtx: { client: ReconcileRpcClient; chainCfg: { chainId: string } };
  }): Promise<ReconcileOutcome> {
    const { row, proposals, confirmedThreshold, confirmedThresholdTag, chainCtx } = args;

    const raw = await chainCtx.client.send<string>('eth_call', [
      { to: row.voting_address, data: encodeGetVote(row.source_id) },
      confirmedThresholdTag,
    ]);
    const vote = decodeGetVote(raw);

    await proposals.markReconcileChecked(row.id, confirmedThreshold.toString());

    let enriched = false;
    if (row.support_required_pct === null) {
      const actions = toProposalActions(vote.script, row.chain_id);
      await this.proposalRepo.insertActions(row.id, actions);
      await proposals.fillSupportQuorum(row.id, {
        supportRequiredPct: vote.supportRequired.toString(),
        minAcceptQuorumPct: vote.minAcceptQuorum.toString(),
      });
      enriched = true;
    }

    if (vote.executed && row.state !== 'executed') {
      this.logger.error('state_reconcile_missed_event', {
        source_type: row.source_type,
        source_id: row.source_id,
        local_state: row.state,
        onchain_state: 'executed',
      });
      return { outcome: 'missed_event' };
    }

    if (vote.open) return { outcome: enriched ? 'enriched' : 'still_open' };

    // Closed and not executed → event-silent terminal: succeeded | defeated.
    const targetState = isPassing(vote) ? 'succeeded' : 'defeated';
    const stateUpdatedAt = await this.readBlockTimestamp(chainCtx, confirmedThreshold.toString());
    const updated = await proposals.reconcileState({
      proposalId: row.id,
      expectedStates: ['active'],
      targetState,
      stateUpdatedAt,
    });
    if (updated === 0) return { outcome: 'guard_skipped' };
    return { outcome: 'corrected', fromState: row.state, toState: targetState };
  }

  private async readBlockTimestamp(
    chainCtx: { client: ReconcileRpcClient },
    blockNumber: string,
  ): Promise<Date> {
    const raw = await chainCtx.client.send<{ timestamp?: string }>('eth_getBlockByNumber', [
      `0x${BigInt(blockNumber).toString(16)}`,
      false,
    ]);
    const timestamp = raw?.timestamp;
    if (!timestamp) throw new Error('missing timestamp');
    return new Date(Number(BigInt(timestamp)) * 1000);
  }
}

/** Aragon `_isValuePct` (strict `>`, PCT_BASE = 10^18) for support and quorum. */
function isPassing(vote: {
  yea: bigint;
  nay: bigint;
  votingPower: bigint;
  supportRequired: bigint;
  minAcceptQuorum: bigint;
}): boolean {
  const cast = vote.yea + vote.nay;
  const supportOk = cast > 0n && (vote.yea * PCT_BASE) / cast > vote.supportRequired;
  const quorumOk =
    vote.votingPower > 0n && (vote.yea * PCT_BASE) / vote.votingPower > vote.minAcceptQuorum;
  return supportOk && quorumOk;
}
