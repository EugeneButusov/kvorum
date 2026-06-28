import type { Logger } from '@libs/chain';
import type { ReconcileOutcome, ReconcileRpcClient, StateReconciler } from '@sources/core';
import {
  DUAL_GOVERNANCE_GETTERS_INTERFACE,
  type DgStateName,
  TIMELOCK_GETTERS_INTERFACE,
  dgStateForOrdinal,
} from '../abi/getters';
import { DG_ONCHAIN_STATE_TO_PG } from '../addresses';
import type {
  DgStaleReconciliationRow,
  DualGovernanceReconcileRepository,
} from '../persistence/dg-reconcile-repository';

/**
 * DAO-wide Dual Governance state reconciler (ADR-0074 §2). **Observational** — it reads
 * `getStateDetails()` at the confirmed threshold and SURFACES, never writes, event-silent
 * effective-vs-persisted drift: every persisted DG transition emits `DualGovernanceStateChanged`, which
 * the state projection records authoritatively (with the correct EVM identity + episode `Context`). The
 * veto/escrow detail rides that event and is filled by the projection, not here.
 *
 * Emergency mode (KNOWN-003) is a belt-and-suspenders check: if `isEmergencyModeActive()`, surface and
 * skip. The primary no-corrupt guarantee is structural — no deriver maps emergency events to
 * `proposal.state`/`dual_governance_state`. The only writes are the reconcile watermark + last observed
 * effective state. In steady state (mainnet `Normal`, no episodes) it advances the watermark and nothing
 * else.
 */
export class DualGovernanceStateReconciler implements StateReconciler<DgStaleReconciliationRow> {
  constructor(
    private readonly logger: Logger,
    readonly sourceTypes: readonly string[],
  ) {}

  async reconcileRow(args: {
    row: DgStaleReconciliationRow;
    proposals: DualGovernanceReconcileRepository;
    confirmedThreshold: bigint;
    confirmedThresholdTag: string;
    chainCtx: { client: ReconcileRpcClient; chainCfg: { chainId: string } };
  }): Promise<ReconcileOutcome> {
    const { row, proposals, confirmedThreshold, confirmedThresholdTag, chainCtx } = args;

    const details = await this.readStateDetails(
      chainCtx.client,
      row.dg_address,
      confirmedThresholdTag,
    );
    // NotInitialized has no PG mapping (pre-init only; never live) → null.
    const pgEffective =
      DG_ONCHAIN_STATE_TO_PG[details.effectiveState as keyof typeof DG_ONCHAIN_STATE_TO_PG] ?? null;

    // Watermark unconditionally (bounds the re-read cadence even when emergency mode is active).
    await proposals.markReconcileChecked(row.id, confirmedThreshold.toString(), pgEffective);

    const emergencyActive = await this.readEmergencyMode(
      chainCtx.client,
      row.timelock_address,
      confirmedThresholdTag,
    );
    if (emergencyActive) {
      this.logger.error('dg_state_reconcile_emergency_mode_active', {
        source_type: row.source_type,
        source_id: row.source_id,
        effective_state: details.effectiveState,
      });
      return { outcome: 'emergency_mode_active' };
    }

    if (details.effectiveState !== details.persistedState) {
      // Event-silent: the effective state runs ahead of the last persisted/observed one. Surface only —
      // the persisted transition will emit DualGovernanceStateChanged and the state projection records it.
      this.logger.warn('dg_state_reconcile_state_drift', {
        source_type: row.source_type,
        source_id: row.source_id,
        effective_state: details.effectiveState,
        persisted_state: details.persistedState,
      });
      return { outcome: 'state_drift' };
    }

    return { outcome: 'checked' };
  }

  private async readStateDetails(
    client: ReconcileRpcClient,
    dgAddress: string,
    blockTag: string,
  ): Promise<{ effectiveState: DgStateName; persistedState: DgStateName }> {
    const raw = await client.send<string>('eth_call', [
      {
        to: dgAddress,
        data: DUAL_GOVERNANCE_GETTERS_INTERFACE.encodeFunctionData('getStateDetails'),
      },
      blockTag,
    ]);
    const [details] = DUAL_GOVERNANCE_GETTERS_INTERFACE.decodeFunctionResult(
      'getStateDetails',
      raw,
    );
    return {
      effectiveState: dgStateForOrdinal(Number(details.effectiveState)),
      persistedState: dgStateForOrdinal(Number(details.persistedState)),
    };
  }

  private async readEmergencyMode(
    client: ReconcileRpcClient,
    timelockAddress: string,
    blockTag: string,
  ): Promise<boolean> {
    const raw = await client.send<string>('eth_call', [
      {
        to: timelockAddress,
        data: TIMELOCK_GETTERS_INTERFACE.encodeFunctionData('isEmergencyModeActive'),
      },
      blockTag,
    ]);
    const [active] = TIMELOCK_GETTERS_INTERFACE.decodeFunctionResult('isEmergencyModeActive', raw);
    return Boolean(active);
  }
}
