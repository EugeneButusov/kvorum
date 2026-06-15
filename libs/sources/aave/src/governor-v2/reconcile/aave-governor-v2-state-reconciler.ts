import type { Logger } from '@libs/chain';
import type { ProposalState } from '@libs/db';
import type { ReconcileOutcome, StateReconciler } from '@sources/core';
import type {
  AaveProposalRepository,
  AaveStaleReconciliationRow,
} from '../../persistence/aave-proposal-repository';
import {
  AaveGovernorV2StateDecodeError,
  decodeGetProposalByIdResult,
  decodeGracePeriodResult,
  decodeProposalStateResult,
  encodeGetProposalByIdCall,
  encodeGetProposalStateCall,
  encodeGracePeriodCall,
  mapAaveV2StateCode,
} from '../abi/governor-state';

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

    const data = encodeGetProposalStateCall(row.source_id);

    const raw = await chainCtx.client.send<string>('eth_call', [
      { to: row.governance_address, data },
      confirmedThresholdTag,
    ]);
    const code = decodeProposalStateResult(raw);
    const mapped = mapAaveV2StateCode(code);

    await proposals.markReconcileChecked(row.id, confirmedThreshold.toString());

    if (mapped === row.state) return { outcome: 'already_consistent' };

    if (
      mapped === 'queued' ||
      mapped === 'executed' ||
      mapped === 'canceled' ||
      mapped === 'succeeded'
    ) {
      this.logger.error('state_reconcile_missed_event', {
        source_type: row.source_type,
        source_id: row.source_id,
        local_state: row.state,
        onchain_state: mapped,
      });
      return { outcome: 'missed_event' };
    }

    let stateUpdatedAt: Date | null = null;

    if (mapped === 'active') {
      stateUpdatedAt = await this.confirmedBlockTimestamp(
        row.voting_starts_block,
        confirmedThreshold,
        chainCtx,
      );
    } else if (mapped === 'defeated') {
      stateUpdatedAt = await this.confirmedBlockTimestamp(
        row.voting_ends_block,
        confirmedThreshold,
        chainCtx,
      );
    } else if (mapped === 'expired') {
      stateUpdatedAt = await this.resolveExpiry(
        row.source_id,
        row.governance_address,
        chainCtx,
        confirmedThresholdTag,
      );
    }

    if (stateUpdatedAt === null) return { outcome: 'guard_skipped' };

    const updated = await proposals.reconcileState({
      proposalId: row.id,
      expectedStates: ['pending', 'active', 'succeeded', 'queued'],
      targetState: mapped as Extract<ProposalState, 'active' | 'defeated' | 'expired'>,
      stateUpdatedAt,
    });

    return updated > 0
      ? { outcome: 'corrected', fromState: row.state, toState: mapped }
      : { outcome: 'guard_skipped' };
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

  private async resolveExpiry(
    sourceId: string,
    governorAddress: string,
    chainCtx: {
      client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
      chainCfg: { chainId: string };
    },
    confirmedThresholdTag: string,
  ): Promise<Date | null> {
    const proposalRaw = await chainCtx.client.send<string>('eth_call', [
      { to: governorAddress, data: encodeGetProposalByIdCall(sourceId) },
      confirmedThresholdTag,
    ]);
    const { executor, executionTime } = decodeGetProposalByIdResult(proposalRaw);

    if (executionTime === 0n) return null;

    const gracePeriod = await this.resolveGracePeriod(
      chainCtx.chainCfg.chainId,
      executor,
      chainCtx,
      confirmedThresholdTag,
    );
    if (gracePeriod === null) return null;

    return new Date((Number(executionTime) + gracePeriod) * 1000);
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
