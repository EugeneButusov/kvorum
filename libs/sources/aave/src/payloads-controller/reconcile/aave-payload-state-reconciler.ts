import type { Logger } from '@libs/chain';
import type { ReconcileOutcome, StateReconciler } from '@sources/core';
import type {
  AavePayloadReconcileRepository,
  AavePayloadStaleReconciliationRow,
} from '../../persistence/aave-payload-reconcile-repository';
import {
  decodePayloadStateResult,
  encodeGetPayloadStateCall,
  mapPayloadStateCode,
} from '../abi/payload-state';

export class AavePayloadStateReconciler
  implements StateReconciler<AavePayloadStaleReconciliationRow>
{
  constructor(
    private readonly logger: Logger,
    readonly sourceTypes: readonly string[],
  ) {}

  async reconcileRow(args: {
    row: AavePayloadStaleReconciliationRow;
    confirmedThreshold: bigint;
    confirmedThresholdTag: string;
    proposals: AavePayloadReconcileRepository;
    chainCtx: {
      client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
      chainCfg: { chainId: string };
    };
  }): Promise<ReconcileOutcome> {
    const { row, proposals, confirmedThreshold, confirmedThresholdTag, chainCtx } = args;
    const mapped = await this.readOnchainState({
      payloadId: row.payload_id,
      controllerAddress: row.payloads_controller_address,
      confirmedThresholdTag,
      chainCtx,
    });

    await proposals.markPayloadReconcileChecked(row.id, confirmedThreshold.toString());

    if (mapped === row.status) return { outcome: 'already_consistent' };
    if (mapped === 'expired') {
      const updated = await proposals.expirePayload(row.id);
      if (updated === 0) return { outcome: 'guard_skipped' };
      return { outcome: 'corrected', fromState: row.status, toState: 'expired' };
    }

    this.logger.error('state_reconcile_missed_event', {
      source_type: row.source_type,
      source_id: row.source_id,
      local_state: row.status,
      onchain_state: mapped,
    });
    return { outcome: 'missed_event' };
  }

  private async readOnchainState(args: {
    payloadId: string;
    controllerAddress: string;
    confirmedThresholdTag: string;
    chainCtx: {
      client: { send<T = unknown>(method: string, params: unknown[]): Promise<T> };
    };
  }) {
    const data = encodeGetPayloadStateCall(args.payloadId);
    const raw = await args.chainCtx.client.send<string>('eth_call', [
      { to: args.controllerAddress, data },
      args.confirmedThresholdTag,
    ]);
    const code = decodePayloadStateResult(raw);
    return mapPayloadStateCode(code);
  }
}
