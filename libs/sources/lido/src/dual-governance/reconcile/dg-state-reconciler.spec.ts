import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import { DualGovernanceStateReconciler } from './dg-state-reconciler';
import { DUAL_GOVERNANCE_GETTERS_INTERFACE, TIMELOCK_GETTERS_INTERFACE } from '../abi/getters';

const DG = '0x' + 'c1'.repeat(20);
const TL = '0x' + 'ce'.repeat(20);

// State enum ordinals: NotInitialized=0, Normal=1, VetoSignalling=2, …
function stateDetails(effective: number, persisted: number): string {
  return DUAL_GOVERNANCE_GETTERS_INTERFACE.encodeFunctionResult('getStateDetails', [
    [effective, persisted, 0, 0, 0, 0, 0, 0],
  ]);
}
function emergencyResult(active: boolean): string {
  return TIMELOCK_GETTERS_INTERFACE.encodeFunctionResult('isEmergencyModeActive', [active]);
}

function makeClient(opts: { effective: number; persisted: number; emergency?: boolean }) {
  return {
    send: vi.fn().mockImplementation((_method: string, params: [{ to: string }, string]) => {
      const to = params[0].to;
      if (to === DG) return Promise.resolve(stateDetails(opts.effective, opts.persisted));
      if (to === TL) return Promise.resolve(emergencyResult(opts.emergency ?? false));
      throw new Error(`unexpected eth_call to ${to}`);
    }),
  };
}

const ROW = {
  id: 'dao-1',
  source_id: DG,
  source_type: 'dual_governance',
  chain_id: '0x1',
  dg_address: DG,
  timelock_address: TL,
};

function reconcile(client: ReturnType<typeof makeClient>, repo: { markReconcileChecked: unknown }) {
  return new DualGovernanceStateReconciler(silentLogger, ['dual_governance']).reconcileRow({
    row: ROW as never,
    proposals: repo as never,
    confirmedThreshold: 988n,
    confirmedThresholdTag: '0x3dc',
    chainCtx: { client: client as never, chainCfg: { chainId: '0x1' } },
  });
}

describe('DualGovernanceStateReconciler', () => {
  it('returns "checked" and watermarks when effective == persisted (steady-state Normal)', async () => {
    const repo = { markReconcileChecked: vi.fn().mockResolvedValue(undefined) };
    const result = await reconcile(makeClient({ effective: 1, persisted: 1 }), repo);
    expect(result).toEqual({ outcome: 'checked' });
    expect(repo.markReconcileChecked).toHaveBeenCalledWith('dao-1', '988', 'normal');
  });

  it('surfaces "state_drift" (no state write) when effective runs ahead of persisted', async () => {
    const repo = { markReconcileChecked: vi.fn().mockResolvedValue(undefined) };
    // effective VetoSignalling(2) vs persisted Normal(1)
    const result = await reconcile(makeClient({ effective: 2, persisted: 1 }), repo);
    expect(result).toEqual({ outcome: 'state_drift' });
    expect(repo.markReconcileChecked).toHaveBeenCalledWith('dao-1', '988', 'veto_signaling');
  });

  it('returns "emergency_mode_active" and still watermarks (KNOWN-003 belt-and-suspenders)', async () => {
    const repo = { markReconcileChecked: vi.fn().mockResolvedValue(undefined) };
    const result = await reconcile(
      makeClient({ effective: 1, persisted: 1, emergency: true }),
      repo,
    );
    expect(result).toEqual({ outcome: 'emergency_mode_active' });
    expect(repo.markReconcileChecked).toHaveBeenCalledWith('dao-1', '988', 'normal');
  });
});
