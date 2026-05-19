import type { Logger } from '@libs/chain';
import type { ProposalState } from '@libs/db';
import {
  GovernorStateDecodeError,
  decodeDelayResult,
  decodeGracePeriodResult,
  decodeStateResult,
  decodeTimelockResult,
  encodeDelayCall,
  encodeGracePeriodCall,
  encodeStateCall,
  encodeTimelockCall,
  mapGovernorStateCode,
} from '../abi/governor-state';
import type {
  CompoundProposalRepository,
  StaleReconciliationRow,
} from '../persistence/compound-proposal-repository';

interface TimelockParams {
  gracePeriod: number;
  delay: number;
}

export class CompoundStateReconciler {
  readonly sourceTypes = ['compound_governor_bravo', 'compound_governor_oz'] as const;
  private readonly timelockCache = new Map<string, TimelockParams>();

  constructor(private readonly logger: Logger) {}

  async reconcileRow(args: {
    row: StaleReconciliationRow;
    confirmedThreshold: bigint;
    confirmedThresholdTag: string;
    proposals: CompoundProposalRepository;
    chainCtx: {
      client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
      chainCfg: { chainId: string };
    };
  }): Promise<
    | { outcome: 'corrected'; fromState: string; toState: string }
    | {
        outcome:
          | 'already_consistent'
          | 'guard_skipped'
          | 'missed_event'
          | 'expired_no_queued_at_block';
      }
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
    if (mapped === 'expired' && row.queued_at_block === null) {
      return { outcome: 'expired_no_queued_at_block' };
    }

    let stateUpdatedAt: Date | null = null;
    if (mapped === 'defeated') {
      if (row.voting_ends_block === null) return { outcome: 'guard_skipped' };
      stateUpdatedAt = await this.readBlockTimestamp(chainCtx, row.voting_ends_block);
    } else if (mapped === 'active') {
      if (row.voting_starts_block === null) return { outcome: 'guard_skipped' };
      stateUpdatedAt = await this.readBlockTimestamp(chainCtx, row.voting_starts_block);
    } else if (mapped === 'expired') {
      if (row.queued_at_block === null) return { outcome: 'expired_no_queued_at_block' };
      const timelockParams = await this.resolveTimelockParams({
        chainId: chainCtx.chainCfg.chainId,
        governorAddress: row.governor_address,
        confirmedThresholdTag,
        chainCtx,
      });
      if (timelockParams === null) return { outcome: 'expired_no_queued_at_block' };
      const queuedTs = await this.readBlockTimestamp(chainCtx, row.queued_at_block);
      stateUpdatedAt = new Date(
        queuedTs.getTime() + (timelockParams.delay + timelockParams.gracePeriod) * 1000,
      );
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

  private async resolveTimelockParams(args: {
    chainId: string;
    governorAddress: string;
    confirmedThresholdTag: string;
    chainCtx: {
      client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
    };
  }): Promise<TimelockParams | null> {
    const cacheKey = `${args.chainId}:${args.governorAddress.toLowerCase()}`;
    const cached = this.timelockCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const timelockRaw = await args.chainCtx.client.send<string>('eth_call', [
        { to: args.governorAddress, data: encodeTimelockCall() },
        args.confirmedThresholdTag,
      ]);
      const timelockAddress = decodeTimelockResult(timelockRaw);

      const [graceRaw, delayRaw] = await Promise.all([
        args.chainCtx.client.send<string>('eth_call', [
          { to: timelockAddress, data: encodeGracePeriodCall() },
          args.confirmedThresholdTag,
        ]),
        args.chainCtx.client.send<string>('eth_call', [
          { to: timelockAddress, data: encodeDelayCall() },
          args.confirmedThresholdTag,
        ]),
      ]);

      const gracePeriod = this.validateSeconds(decodeGracePeriodResult(graceRaw));
      const delay = this.validateSeconds(decodeDelayResult(delayRaw));

      if (gracePeriod !== null && delay !== null) {
        const params = { gracePeriod, delay };
        this.timelockCache.set(cacheKey, params);
        return params;
      }
    } catch (err) {
      if (err instanceof GovernorStateDecodeError) throw err;
    }

    return null;
  }

  private validateSeconds(value: number): number | null {
    const min = Number(process.env['COMPOUND_GOVERNOR_GRACE_MIN_SECONDS'] ?? 3_600);
    const max = Number(process.env['COMPOUND_GOVERNOR_GRACE_MAX_SECONDS'] ?? 7_776_000);
    if (!Number.isInteger(value)) return null;
    if (value < min || value > max) return null;
    return value;
  }
}
