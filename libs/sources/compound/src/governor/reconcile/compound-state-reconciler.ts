import type { Logger } from '@libs/chain';
import type { ProposalRepository, ProposalState, StaleReconciliationRow } from '@libs/db';
import type { ProposalStateReconcilerPlugin } from '@sources/core';
import {
  GovernorStateDecodeError,
  decodeGracePeriodResult,
  decodeStateResult,
  decodeTimelockResult,
  encodeGracePeriodCall,
  encodeStateCall,
  encodeTimelockCall,
  mapGovernorStateCode,
} from '../abi/governor-state';

export class CompoundStateReconciler implements ProposalStateReconcilerPlugin {
  readonly sourceType = 'compound_governor_bravo';
  readonly supportedChainId: string;
  private readonly graceCache = new Map<string, number>();

  constructor(
    chainId: string,
    private readonly logger: Logger,
  ) {
    this.supportedChainId = chainId;
  }

  async reconcileRow(args: {
    row: StaleReconciliationRow;
    confirmedThreshold: bigint;
    confirmedThresholdTag: string;
    proposals: ProposalRepository;
    chainCtx: {
      client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
      chainCfg: { chainId: string };
    };
  }): Promise<
    | { outcome: 'corrected'; fromState: string; toState: string }
    | { outcome: 'already_consistent' | 'guard_skipped' | 'missed_event' | 'expired_no_eta' }
  > {
    const { row, chainCtx, proposals, confirmedThreshold, confirmedThresholdTag } = args;
    const mapped = await this.readOnchainState({
      sourceId: row.source_id,
      governorAddress: row.governor_address,
      confirmedThresholdTag,
      chainCtx,
    });

    await proposals.markReconcileChecked(row.id, confirmedThreshold.toString());

    if (mapped === row.state) return { outcome: 'already_consistent' };
    if (mapped === 'executed' || mapped === 'queued' || mapped === 'canceled') {
      this.logger.error('state_reconcile_missed_event', {
        source_type: row.source_type,
        source_id: row.source_id,
        local_state: row.state,
        onchain_state: mapped,
      });
      return { outcome: 'missed_event' };
    }
    if (mapped === 'expired' && row.timelock_eta === null) return { outcome: 'expired_no_eta' };

    let stateUpdatedAt: Date | null = null;
    if (mapped === 'defeated') {
      if (row.voting_ends_block === null) return { outcome: 'guard_skipped' };
      stateUpdatedAt = await this.readBlockTimestamp(chainCtx, row.voting_ends_block);
    } else if (mapped === 'active') {
      if (row.voting_starts_block === null) return { outcome: 'guard_skipped' };
      stateUpdatedAt = await this.readBlockTimestamp(chainCtx, row.voting_starts_block);
    } else if (mapped === 'expired') {
      const graceSeconds = await this.resolveGracePeriodSeconds({
        chainId: chainCtx.chainCfg.chainId,
        governorAddress: row.governor_address,
        confirmedThresholdTag,
        chainCtx,
      });
      if (graceSeconds === null || row.timelock_eta === null) return { outcome: 'expired_no_eta' };
      stateUpdatedAt = new Date(row.timelock_eta.getTime() + graceSeconds * 1000);
    }

    if (stateUpdatedAt === null) return { outcome: 'guard_skipped' };

    const updated = await proposals.reconcileState({
      proposalId: row.id,
      expectedStates: ['pending', 'active', 'succeeded', 'queued'],
      targetState: mapped as Extract<ProposalState, 'active' | 'defeated' | 'expired'>,
      stateUpdatedAt,
    });
    if (updated === 0) return { outcome: 'guard_skipped' };

    return { outcome: 'corrected', fromState: row.state, toState: mapped };
  }

  private async readOnchainState(args: {
    sourceId: string;
    governorAddress: string;
    confirmedThresholdTag: string;
    chainCtx: {
      client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
    };
  }): Promise<ProposalState> {
    const data = encodeStateCall(args.sourceId);
    const raw = await args.chainCtx.client.send<string>('eth_call', [
      { to: args.governorAddress, data },
      args.confirmedThresholdTag,
    ]);
    const code = decodeStateResult(raw);
    return mapGovernorStateCode(code);
  }

  private async readBlockTimestamp(
    chainCtx: {
      client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
    },
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

  private async resolveGracePeriodSeconds(args: {
    chainId: string;
    governorAddress: string;
    confirmedThresholdTag: string;
    chainCtx: {
      client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
    };
  }): Promise<number | null> {
    const cacheKey = `${args.chainId}:${args.governorAddress.toLowerCase()}`;
    const cached = this.graceCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const timelockRaw = await args.chainCtx.client.send<string>('eth_call', [
        { to: args.governorAddress, data: encodeTimelockCall() },
        args.confirmedThresholdTag,
      ]);
      const timelockAddress = decodeTimelockResult(timelockRaw);
      const graceRaw = await args.chainCtx.client.send<string>('eth_call', [
        { to: timelockAddress, data: encodeGracePeriodCall() },
        args.confirmedThresholdTag,
      ]);
      const grace = this.validateGrace(decodeGracePeriodResult(graceRaw));
      if (grace !== null) {
        this.graceCache.set(cacheKey, grace);
        return grace;
      }
    } catch (err) {
      if (err instanceof GovernorStateDecodeError) throw err;
    }

    const fallbackRaw = process.env['GOVERNOR_GRACE_PERIOD_SECONDS'];
    const fallback = fallbackRaw === undefined ? null : this.validateGrace(Number(fallbackRaw));
    if (fallback !== null) {
      this.graceCache.set(cacheKey, fallback);
      return fallback;
    }
    return null;
  }

  private validateGrace(value: number): number | null {
    const min = Number(process.env['GOVERNOR_GRACE_MIN_SECONDS'] ?? 3_600);
    const max = Number(process.env['GOVERNOR_GRACE_MAX_SECONDS'] ?? 7_776_000);
    if (!Number.isInteger(value)) return null;
    if (value < min || value > max) return null;
    return value;
  }
}
