import { describe, expect, it, vi } from 'vitest';
import { ReconcileDriver } from '@sources/core';
import { AavePayloadStateReconciler } from './aave-payload-state-reconciler';
import { PAYLOAD_STATE_INTERFACE } from '../abi/payload-state';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeProposals() {
  return {
    markPayloadReconcileChecked: vi.fn().mockResolvedValue(undefined),
    expirePayload: vi.fn().mockResolvedValue(1),
    findStaleForReconciliation: vi.fn().mockResolvedValue([]),
  };
}

function makeChainCtx(sendImpl?: (method: string, params: unknown[]) => unknown) {
  return {
    client: {
      send: vi.fn(async (method: string, params: unknown[]) => {
        if (sendImpl) return sendImpl(method, params);
        if (method === 'eth_call') {
          return PAYLOAD_STATE_INTERFACE.encodeFunctionResult('getPayloadById', [
            ['0x' + '11'.repeat(20), 1n, 5n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, []],
          ]);
        }
        throw new Error(`unexpected method ${method}`);
      }),
    },
    chainCfg: { chainId: '0xa' },
  };
}

function makeRow(
  overrides: Partial<{
    id: string;
    source_id: string;
    source_type: string;
    chain_id: string;
    payloads_controller_address: string;
    payload_id: string;
    status: 'created' | 'queued';
  }> = {},
) {
  return {
    id: 'payload-row-1',
    source_id: '17',
    source_type: 'aave_payloads_controller',
    chain_id: '0xa',
    payloads_controller_address: '0x' + '22'.repeat(20),
    payload_id: '17',
    status: 'created' as const,
    ...overrides,
  };
}

describe('AavePayloadStateReconciler', () => {
  it('expires created or queued rows when onchain state is expired', async () => {
    const proposals = makeProposals();
    const reconciler = new AavePayloadStateReconciler(makeLogger() as never, [
      'aave_payloads_controller',
    ]);

    const result = await reconciler.reconcileRow({
      row: makeRow(),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: makeChainCtx() as never,
    });

    expect(proposals.markPayloadReconcileChecked).toHaveBeenCalledWith('payload-row-1', '1000');
    expect(proposals.expirePayload).toHaveBeenCalledWith('payload-row-1');
    expect(result).toEqual({ outcome: 'corrected', fromState: 'created', toState: 'expired' });
  });

  it('returns guard_skipped when expirePayload updates no rows', async () => {
    const proposals = makeProposals();
    proposals.expirePayload.mockResolvedValue(0);
    const reconciler = new AavePayloadStateReconciler(makeLogger() as never, [
      'aave_payloads_controller',
    ]);

    const result = await reconciler.reconcileRow({
      row: makeRow({ status: 'queued' }),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: makeChainCtx() as never,
    });

    expect(result).toEqual({ outcome: 'guard_skipped' });
  });

  it('returns already_consistent when onchain state matches local state', async () => {
    const proposals = makeProposals();
    const reconciler = new AavePayloadStateReconciler(makeLogger() as never, [
      'aave_payloads_controller',
    ]);

    const result = await reconciler.reconcileRow({
      row: makeRow({ status: 'queued' }),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: makeChainCtx(() =>
        PAYLOAD_STATE_INTERFACE.encodeFunctionResult('getPayloadById', [
          ['0x' + '11'.repeat(20), 1n, 2n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, []],
        ]),
      ) as never,
    });

    expect(result).toEqual({ outcome: 'already_consistent' });
  });

  it('returns missed_event for executed divergence without writing', async () => {
    const logger = makeLogger();
    const proposals = makeProposals();
    const reconciler = new AavePayloadStateReconciler(logger as never, [
      'aave_payloads_controller',
    ]);

    const result = await reconciler.reconcileRow({
      row: makeRow(),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: makeChainCtx(() =>
        PAYLOAD_STATE_INTERFACE.encodeFunctionResult('getPayloadById', [
          ['0x' + '11'.repeat(20), 1n, 3n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, []],
        ]),
      ) as never,
    });

    expect(result).toEqual({ outcome: 'missed_event' });
    expect(logger.error).toHaveBeenCalledWith(
      'state_reconcile_missed_event',
      expect.objectContaining({ onchain_state: 'executed' }),
    );
    expect(proposals.expirePayload).not.toHaveBeenCalled();
  });

  it('treats None state as missed_event without throwing', async () => {
    const logger = makeLogger();
    const proposals = makeProposals();
    const reconciler = new AavePayloadStateReconciler(logger as never, [
      'aave_payloads_controller',
    ]);

    const result = await reconciler.reconcileRow({
      row: makeRow(),
      proposals: proposals as never,
      confirmedThreshold: 1000n,
      confirmedThresholdTag: '0x3e8',
      chainCtx: makeChainCtx(() =>
        PAYLOAD_STATE_INTERFACE.encodeFunctionResult('getPayloadById', [
          ['0x' + '11'.repeat(20), 1n, 0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, []],
        ]),
      ) as never,
    });

    expect(result).toEqual({ outcome: 'missed_event' });
    expect(logger.error).toHaveBeenCalledWith(
      'state_reconcile_missed_event',
      expect.objectContaining({ onchain_state: 'none' }),
    );
  });

  it('propagates transient rpc failures', async () => {
    const reconciler = new AavePayloadStateReconciler(makeLogger() as never, [
      'aave_payloads_controller',
    ]);

    await expect(
      reconciler.reconcileRow({
        row: makeRow(),
        proposals: makeProposals() as never,
        confirmedThreshold: 1000n,
        confirmedThresholdTag: '0x3e8',
        chainCtx: {
          client: {
            send: vi.fn().mockRejectedValue(new Error('boom')),
          },
          chainCfg: { chainId: '0xa' },
        } as never,
      }),
    ).rejects.toThrow('boom');
  });

  it('uses target_chain_id rows so the driver reconciles against the matching destination bound', async () => {
    const proposals = {
      ...makeProposals(),
      findStaleForReconciliation: vi.fn().mockResolvedValue([makeRow({ chain_id: '0xa' })]),
    };
    const metrics = {
      recordBacklog: vi.fn(),
      recordBatchSaturated: vi.fn(),
      recordOutcome: vi.fn(),
      recordRpcFailEscalated: vi.fn(),
      recordTickDurationSeconds: vi.fn(),
    };
    const reconciler = new AavePayloadStateReconciler(makeLogger() as never, [
      'aave_payloads_controller',
    ]);
    const driver = new ReconcileDriver(
      reconciler,
      proposals as never,
      metrics,
      makeLogger() as never,
      { batchSize: 50, rpcFailEscalateAfter: 5 },
    );
    const baseClient = {
      send: vi.fn(async () =>
        PAYLOAD_STATE_INTERFACE.encodeFunctionResult('getPayloadById', [
          ['0x' + '11'.repeat(20), 1n, 5n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, []],
        ]),
      ),
    };
    const wrongClient = { send: vi.fn() };

    await driver.onConfirmedHeads([
      {
        chainId: '0x1',
        confirmedThresholdBlock: '1000',
        recheckGapBlocks: 600,
        client: wrongClient,
      },
      {
        chainId: '0xa',
        confirmedThresholdBlock: '1000',
        recheckGapBlocks: 600,
        client: baseClient,
      },
    ]);

    expect(baseClient.send).toHaveBeenCalled();
    expect(wrongClient.send).not.toHaveBeenCalled();
  });
});
