import { describe, expect, it, vi } from 'vitest';
import { GOVERNOR_STATE_INTERFACE } from '../abi/governor-state';
import { CompoundStateReconciler } from './compound-state-reconciler';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('CompoundStateReconciler', () => {
  it('reconciles oz governor row to defeated using voting_ends_block timestamp', async () => {
    const reconciler = new CompoundStateReconciler(makeLogger() as never);
    const proposals = {
      markReconcileChecked: vi.fn().mockResolvedValue(undefined),
      reconcileState: vi.fn().mockResolvedValue(1),
    };

    const send = vi.fn(async (method: string, params: unknown[]) => {
      if (method === 'eth_call') {
        const request = params[0] as { to: string };
        if (request.to.toLowerCase() === '0x309a862bbc1a00e45506cb8a802d1ff10004c8c0') {
          return GOVERNOR_STATE_INTERFACE.encodeFunctionResult('state', [3n]); // defeated
        }
      }
      if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' }; // 100
      throw new Error(`unexpected rpc call: ${method}`);
    });

    const result = await reconciler.reconcileRow({
      row: {
        id: 'proposal-oz-1',
        source_id: '394',
        source_type: 'compound_governor_oz',
        chain_id: '0x1',
        governor_address: '0x309a862bbC1A00e45506cB8A802D1ff10004c8C0',
        state: 'pending',
        voting_starts_block: '21690000',
        voting_ends_block: '21690100',
        queued_at_block: null,
      },
      confirmedThreshold: 21699999n,
      confirmedThresholdTag: '0x14b063f',
      proposals: proposals as never,
      chainCtx: {
        client: { send },
        chainCfg: { chainId: '0x1' },
      },
    });

    expect(result).toEqual({
      outcome: 'corrected',
      fromState: 'pending',
      toState: 'defeated',
    });
    expect(proposals.markReconcileChecked).toHaveBeenCalledWith('proposal-oz-1', '21699999');
    expect(proposals.reconcileState).toHaveBeenCalledWith({
      proposalId: 'proposal-oz-1',
      expectedStates: ['pending', 'active', 'succeeded', 'queued'],
      targetState: 'defeated',
      stateUpdatedAt: new Date(100_000),
    });
  });
});
