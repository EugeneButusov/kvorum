import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { ReconcileRpcClient } from '@sources/core';
import { EasyTrackStateReconciler } from './easy-track-state-reconciler';
import { EASY_TRACK_GETTERS_INTERFACE } from '../abi/getters';
import type {
  EasyTrackReconcileRepository,
  EasyTrackStaleReconciliationRow,
} from '../persistence/reconcile-repository';

const ET_ADDRESS = '0xf0211b7660680b49de1a7e9f25c65660f0a13fea';
const HASH = '0x' + 'ab'.repeat(32);

// A motion tuple: id 42, startDate 1000 + duration 200 → window ends at 1200.
function motionTuple(id: bigint, startDate: bigint, duration: bigint): unknown[] {
  return [id, ET_ADDRESS, '0x' + '11'.repeat(20), duration, startDate, 0n, 50n, 0n, HASH];
}

function makeClient(motions: unknown[][], blockTs: number) {
  const raw = EASY_TRACK_GETTERS_INTERFACE.encodeFunctionResult('getMotions', [motions]);
  const send = vi.fn((method: string) => {
    if (method === 'eth_call') return Promise.resolve(raw);
    if (method === 'eth_getBlockByNumber') {
      return Promise.resolve({ timestamp: '0x' + blockTs.toString(16) });
    }
    return Promise.resolve(undefined);
  });
  return { client: { send } as unknown as ReconcileRpcClient, send };
}

function makeProposals(updated = 1) {
  return {
    reconcileState: vi.fn().mockResolvedValue(updated),
    markReconcileChecked: vi.fn().mockResolvedValue(undefined),
  } as unknown as EasyTrackReconcileRepository;
}

const ROW: EasyTrackStaleReconciliationRow = {
  id: 'p-1',
  source_id: '42',
  source_type: 'easy_track',
  chain_id: '0x1',
  easy_track_address: ET_ADDRESS,
  state: 'active',
};

function run(
  reconciler: EasyTrackStateReconciler,
  proposals: EasyTrackReconcileRepository,
  client: ReconcileRpcClient,
  row = ROW,
) {
  return reconciler.reconcileRow({
    row,
    proposals,
    confirmedThreshold: 100n,
    confirmedThresholdTag: '0x64',
    chainCtx: { client, chainCfg: { chainId: '0x1' } },
  });
}

describe('EasyTrackStateReconciler', () => {
  it('corrects active → queued when the motion is past its window (optimistic pass)', async () => {
    const reconciler = new EasyTrackStateReconciler(silentLogger, ['easy_track']);
    const proposals = makeProposals(1);
    const { client } = makeClient([motionTuple(42n, 1000n, 200n)], 2000); // blockTs 2000 > window 1200

    const outcome = await run(reconciler, proposals, client);

    expect(proposals.markReconcileChecked).toHaveBeenCalledWith('p-1', '100');
    expect(proposals.reconcileState).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: 'p-1',
        expectedStates: ['active'],
        targetState: 'queued',
        stateUpdatedAt: new Date(2000 * 1000),
      }),
    );
    expect(outcome).toEqual({ outcome: 'corrected', fromState: 'active', toState: 'queued' });
  });

  it('leaves a motion still inside its window untouched (still_open)', async () => {
    const reconciler = new EasyTrackStateReconciler(silentLogger, ['easy_track']);
    const proposals = makeProposals();
    const { client } = makeClient([motionTuple(42n, 1000n, 200n)], 1100); // blockTs 1100 < window 1200

    const outcome = await run(reconciler, proposals, client);

    expect(proposals.markReconcileChecked).toHaveBeenCalledWith('p-1', '100');
    expect(proposals.reconcileState).not.toHaveBeenCalled();
    expect(outcome).toEqual({ outcome: 'still_open' });
  });

  it('treats a motion absent from getMotions as closed (terminal event is authoritative)', async () => {
    const reconciler = new EasyTrackStateReconciler(silentLogger, ['easy_track']);
    const proposals = makeProposals();
    const { client } = makeClient([motionTuple(99n, 1000n, 200n)], 2000); // active set has motion 99, not 42

    const outcome = await run(reconciler, proposals, client);

    expect(proposals.reconcileState).not.toHaveBeenCalled();
    expect(outcome).toEqual({ outcome: 'closed' });
  });

  it('reports guard_skipped when the proposal is no longer active', async () => {
    const reconciler = new EasyTrackStateReconciler(silentLogger, ['easy_track']);
    const proposals = makeProposals(0); // reconcileState updates nothing
    const { client } = makeClient([motionTuple(42n, 1000n, 200n)], 2000);

    const outcome = await run(reconciler, proposals, client);

    expect(proposals.reconcileState).toHaveBeenCalled();
    expect(outcome).toEqual({ outcome: 'guard_skipped' });
  });

  it('throws when the confirmed block has no timestamp', async () => {
    const reconciler = new EasyTrackStateReconciler(silentLogger, ['easy_track']);
    const proposals = makeProposals();
    const raw = EASY_TRACK_GETTERS_INTERFACE.encodeFunctionResult('getMotions', [
      [motionTuple(42n, 1000n, 200n)],
    ]);
    const client = {
      send: vi.fn((method: string) => {
        if (method === 'eth_call') return Promise.resolve(raw);
        return Promise.resolve({}); // eth_getBlockByNumber → no timestamp
      }),
    } as unknown as ReconcileRpcClient;

    await expect(run(reconciler, proposals, client)).rejects.toThrow('missing block timestamp');
  });

  it('caches getMotions per tick — one eth_call across rows at the same confirmed head', async () => {
    const reconciler = new EasyTrackStateReconciler(silentLogger, ['easy_track']);
    const proposals = makeProposals();
    const { client, send } = makeClient([motionTuple(42n, 1000n, 200n)], 1100);

    await run(reconciler, proposals, client);
    await run(reconciler, proposals, client, { ...ROW, id: 'p-2', source_id: '42' });

    const ethCalls = send.mock.calls.filter(([m]) => m === 'eth_call');
    expect(ethCalls).toHaveLength(1);
  });
});
