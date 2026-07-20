import type { Logger } from '@libs/chain';
import type { ProposalState } from '@libs/db';
import { type ReconcileOutcome, type StateReconciler, isTransientRpcError } from '@sources/core';
import type {
  AaveProposalRepository,
  AaveStaleReconciliationRow,
} from '../../persistence/aave-proposal-repository';
import {
  AAVE_V2_STATE_FAILED,
  AAVE_V2_STATE_SUCCEEDED,
  AaveGovernorV2StateDecodeError,
  decodeGetProposalByIdResult,
  decodeGracePeriodResult,
  decodeProposalStateResult,
  deriveAaveV2State,
  encodeGetProposalByIdCall,
  encodeGetProposalStateCall,
  encodeGracePeriodCall,
} from '../abi/governor-state';

/**
 * `getProposalState` reverts at the confirmed head but works at a block near the proposal's own
 * conclusion. The vote outcome is settled the moment voting ends, so a few blocks past `endBlock` is
 * enough — and staying close keeps the call before the v2→v3 migration broke the strategy snapshot.
 */
const OUTCOME_BLOCK_OFFSET = BigInt(process.env['AAVE_V2_OUTCOME_BLOCK_OFFSET'] ?? '5');

export class AaveGovernorV2StateReconciler implements StateReconciler<AaveStaleReconciliationRow> {
  private readonly gracePeriodCache = new Map<string, number>();

  constructor(
    private readonly logger: Logger,
    readonly sourceTypes: readonly string[],
  ) {}

  async reconcileRow(args: {
    row: AaveStaleReconciliationRow;
    confirmedThreshold: bigint;
    confirmedThresholdTag: string;
    proposals: AaveProposalRepository;
    chainCtx: {
      client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
      chainCfg: { chainId: string };
    };
  }): Promise<ReconcileOutcome> {
    const { row, chainCtx, proposals, confirmedThreshold, confirmedThresholdTag } = args;

    // Read the raw proposal struct, NOT getProposalState. getProposalState (and the isProposalPassed
    // it calls) revert for every historical proposal on this contract — the strategy's voting-power
    // snapshot broke in the v2→v3 migration. getProposalById touches no strategy, so it still works.
    const raw = await chainCtx.client.send<string>('eth_call', [
      { to: row.governance_address, data: encodeGetProposalByIdCall(row.source_id) },
      confirmedThresholdTag,
    ]);
    const summary = decodeGetProposalByIdResult(raw);
    const derived = deriveAaveV2State(summary, confirmedThreshold);

    await proposals.markReconcileChecked(row.id, confirmedThreshold.toString());

    const resolved = await this.resolveTargetState(derived, {
      row,
      chainCtx,
      confirmedThreshold,
      confirmedThresholdTag,
    });
    if (resolved.outcome !== undefined) return resolved.outcome;

    const { mapped, stateUpdatedAt } = resolved;
    if (mapped === row.state) return { outcome: 'already_consistent' };
    if (stateUpdatedAt === null) return { outcome: 'guard_skipped' };

    const updated = await proposals.reconcileState({
      proposalId: row.id,
      expectedStates: ['pending', 'active', 'succeeded', 'queued'],
      targetState: mapped,
      stateUpdatedAt,
    });

    return updated > 0
      ? { outcome: 'corrected', fromState: row.state, toState: mapped }
      : { outcome: 'guard_skipped' };
  }

  /**
   * Turns a `deriveAaveV2State` result into a reconcilable target state + timestamp, or an early
   * outcome. `canceled`/`executed`/`queued` are on-chain states that arrive as events we should have
   * ingested — a stale row in one of them is a missed event, not something the reconciler invents.
   * `defeated` and `expired` have no terminal event on Aave v2, so those are what it resolves.
   */
  private async resolveTargetState(
    derived: ReturnType<typeof deriveAaveV2State>,
    ctx: {
      row: AaveStaleReconciliationRow;
      chainCtx: {
        client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
        chainCfg: { chainId: string };
      };
      confirmedThreshold: bigint;
      confirmedThresholdTag: string;
    },
  ): Promise<
    | { outcome: ReconcileOutcome; mapped?: undefined; stateUpdatedAt?: undefined }
    | {
        outcome?: undefined;
        mapped: Extract<ProposalState, 'active' | 'defeated' | 'expired' | 'succeeded'>;
        stateUpdatedAt: Date | null;
      }
  > {
    const { row, chainCtx, confirmedThreshold, confirmedThresholdTag } = ctx;

    if (derived.kind === 'not_stale') {
      if (derived.state === 'pending') {
        return derived.state === row.state
          ? { outcome: { outcome: 'already_consistent' } }
          : { outcome: { outcome: 'guard_skipped' } };
      }
      return {
        mapped: 'active',
        stateUpdatedAt: await this.confirmedBlockTimestamp(
          row.voting_starts_block,
          confirmedThreshold,
          chainCtx,
        ),
      };
    }

    if (derived.kind === 'terminal') {
      // canceled / executed carry on-chain events we should already hold.
      this.logMissedEvent(row, derived.state);
      return { outcome: { outcome: 'missed_event' } };
    }

    if (derived.kind === 'needs_outcome') {
      // Concluded but never queued: ask the chain for the authoritative Failed-vs-Succeeded verdict
      // (which needs the quorum math) at a block where getProposalState still runs.
      return {
        mapped: await this.resolveVoteOutcome(row, derived.endBlock, chainCtx),
        stateUpdatedAt: await this.confirmedBlockTimestamp(
          row.voting_ends_block,
          confirmedThreshold,
          chainCtx,
        ),
      };
    }

    // awaiting_execution: queued on-chain. It is `expired` once past the executor's grace window,
    // otherwise genuinely `queued` — which is an event we should have ingested.
    const gracePeriod = await this.resolveGracePeriod(
      chainCtx.chainCfg.chainId,
      derived.executor,
      chainCtx,
      confirmedThresholdTag,
    );
    if (gracePeriod === null) return { outcome: { outcome: 'guard_skipped' } };

    const expiryTime = Number(derived.executionTime) + gracePeriod;
    const headTime = await this.readBlockTimestamp(chainCtx, confirmedThreshold.toString());
    if (headTime.getTime() / 1000 < expiryTime) {
      this.logMissedEvent(row, 'queued');
      return { outcome: { outcome: 'missed_event' } };
    }
    return { mapped: 'expired', stateUpdatedAt: new Date(expiryTime * 1000) };
  }

  /**
   * The authoritative vote outcome for a concluded, never-queued proposal: `getProposalState` at
   * `endBlock + OUTCOME_BLOCK_OFFSET`, where it still evaluates the quorum snapshot correctly.
   * `Failed → defeated`, `Succeeded → succeeded`. If the call reverts anyway (a proposal too close to
   * the migration boundary), fall back to `defeated`: a concluded proposal that never advanced to
   * execution did not pass. Transient RPC errors are rethrown so the driver retries them.
   */
  private async resolveVoteOutcome(
    row: AaveStaleReconciliationRow,
    endBlock: bigint,
    chainCtx: { client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> } },
  ): Promise<'defeated' | 'succeeded'> {
    const blockTag = `0x${(endBlock + OUTCOME_BLOCK_OFFSET).toString(16)}`;
    let code: number;
    try {
      const raw = await chainCtx.client.send<string>('eth_call', [
        { to: row.governance_address, data: encodeGetProposalStateCall(row.source_id) },
        blockTag,
      ]);
      code = decodeProposalStateResult(raw);
    } catch (err) {
      if (isTransientRpcError(err)) throw err;
      this.logger.warn('v2_vote_outcome_unavailable', {
        source_id: row.source_id,
        block_tag: blockTag,
        error: String(err),
      });
      return 'defeated';
    }

    if (code === AAVE_V2_STATE_SUCCEEDED) return 'succeeded';
    if (code === AAVE_V2_STATE_FAILED) return 'defeated';
    // Any other code at endBlock+offset for a never-queued proposal is unexpected; a concluded,
    // never-executed proposal is still terminally defeated.
    this.logger.warn('v2_vote_outcome_unexpected', {
      source_id: row.source_id,
      state_code: code,
    });
    return 'defeated';
  }

  private logMissedEvent(row: AaveStaleReconciliationRow, onchain: ProposalState): void {
    this.logger.error('state_reconcile_missed_event', {
      source_type: row.source_type,
      source_id: row.source_id,
      local_state: row.state,
      onchain_state: onchain,
    });
  }

  private async confirmedBlockTimestamp(
    blockNumber: string | null,
    confirmedThreshold: bigint,
    chainCtx: { client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> } },
  ): Promise<Date | null> {
    if (blockNumber === null) return null;
    if (BigInt(blockNumber) > confirmedThreshold) return null;
    return this.readBlockTimestamp(chainCtx, blockNumber);
  }

  private async resolveGracePeriod(
    chainId: string,
    executorAddress: string,
    chainCtx: { client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> } },
    confirmedThresholdTag: string,
  ): Promise<number | null> {
    const cacheKey = `${chainId}:${executorAddress.toLowerCase()}`;
    const cached = this.gracePeriodCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const raw = await chainCtx.client.send<string>('eth_call', [
        { to: executorAddress, data: encodeGracePeriodCall() },
        confirmedThresholdTag,
      ]);
      const seconds = this.validateSeconds(decodeGracePeriodResult(raw));
      if (seconds === null) return null;
      this.gracePeriodCache.set(cacheKey, seconds);
      return seconds;
    } catch (err) {
      if (err instanceof AaveGovernorV2StateDecodeError) throw err;
      return null;
    }
  }

  private async readBlockTimestamp(
    chainCtx: { client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> } },
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

  private validateSeconds(value: number): number | null {
    const min = Number(process.env['AAVE_V2_GRACE_MIN_SECONDS'] ?? 3_600);
    const max = Number(process.env['AAVE_V2_GRACE_MAX_SECONDS'] ?? 7_776_000);
    if (value < min || value > max) return null;
    return value;
  }
}
