import type { Logger } from '@libs/chain';
import type { ReconcileOutcome, StateReconciler } from '@sources/core';
import type {
  AaveProposalRepository,
  AaveStaleReconciliationRow,
} from '../../persistence/aave-proposal-repository';
import {
  AaveGovernanceStateDecodeError,
  decodeExpirationTimeResult,
  decodeProposalStateResult,
  encodeExpirationTimeCall,
  encodeGetProposalStateCall,
  mapAaveStateCode,
} from '../abi/governance-state';

export class AaveGovernanceStateReconciler implements StateReconciler<AaveStaleReconciliationRow> {
  private readonly expirationCache = new Map<string, number>();

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
    const { row, proposals, confirmedThreshold, confirmedThresholdTag, chainCtx } = args;
    const mapped = await this.readOnchainState({
      sourceId: row.source_id,
      governanceAddress: row.governance_address,
      confirmedThresholdTag,
      chainCtx,
    });

    await proposals.markReconcileChecked(row.id, confirmedThreshold.toString());

    if (mapped === row.state) return { outcome: 'already_consistent' };
    if (mapped !== 'expired') {
      this.logger.error('state_reconcile_missed_event', {
        source_type: row.source_type,
        source_id: row.source_id,
        local_state: row.state,
        onchain_state: mapped,
      });
      return { outcome: 'missed_event' };
    }

    const expirationSecs = await this.resolveExpirationTime({
      chainId: chainCtx.chainCfg.chainId,
      governanceAddress: row.governance_address,
      confirmedThresholdTag,
      chainCtx,
    });
    if (expirationSecs === null) return { outcome: 'guard_skipped' };

    const creationTs = await this.readBlockTimestamp(chainCtx, row.creation_block);
    const stateUpdatedAt = new Date(creationTs.getTime() + expirationSecs * 1000);

    const updated = await proposals.reconcileState({
      proposalId: row.id,
      expectedStates: ['pending', 'active', 'queued'],
      targetState: 'expired',
      stateUpdatedAt,
    });
    if (updated === 0) return { outcome: 'guard_skipped' };

    return { outcome: 'corrected', fromState: row.state, toState: 'expired' };
  }

  private async readOnchainState(args: {
    sourceId: string;
    governanceAddress: string;
    confirmedThresholdTag: string;
    chainCtx: {
      client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
    };
  }) {
    const data = encodeGetProposalStateCall(args.sourceId);
    const raw = await args.chainCtx.client.send<string>('eth_call', [
      { to: args.governanceAddress, data },
      args.confirmedThresholdTag,
    ]);
    const code = decodeProposalStateResult(raw);
    return mapAaveStateCode(code);
  }

  private async resolveExpirationTime(args: {
    chainId: string;
    governanceAddress: string;
    confirmedThresholdTag: string;
    chainCtx: {
      client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
    };
  }): Promise<number | null> {
    const cacheKey = `${args.chainId}:${args.governanceAddress.toLowerCase()}`;
    const cached = this.expirationCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const raw = await args.chainCtx.client.send<string>('eth_call', [
        { to: args.governanceAddress, data: encodeExpirationTimeCall() },
        args.confirmedThresholdTag,
      ]);
      const seconds = this.validateSeconds(decodeExpirationTimeResult(raw));
      if (seconds === null) return null;
      this.expirationCache.set(cacheKey, seconds);
      return seconds;
    } catch (err) {
      if (err instanceof AaveGovernanceStateDecodeError) throw err;
      return null;
    }
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

  private validateSeconds(value: number): number | null {
    const min = Number(process.env['AAVE_PROPOSAL_EXPIRATION_MIN_SECONDS'] ?? 3600);
    const max = Number(process.env['AAVE_PROPOSAL_EXPIRATION_MAX_SECONDS'] ?? 7776000);
    if (value < min || value > max) return null;
    return value;
  }
}
