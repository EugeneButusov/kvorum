import { describe, expect, it, vi } from 'vitest';
import { runStartupGapFill } from './startup-gap-fill';

vi.mock('./backfill-driver', () => ({
  BackfillDriver: vi.fn(),
}));

describe('runStartupGapFill', () => {
  it('#1 - returns no_gap when compute gap is empty', async () => {
    const repo = {
      findByIdWithChain: vi.fn().mockResolvedValue({
        id: 'src-1',
        active_from_block: '100',
        backfill_head_block: '200',
        live_head_block: '205',
      }),
    } as never;

    const rpc = { send: vi.fn().mockResolvedValue('0xd2') } as never;

    const out = await runStartupGapFill({
      daoSourceId: 'src-1',
      chainConfig: { reorgHorizon: 5 } as never,
      rpcClient: rpc,
      daoSourceRepo: repo,
      runtime: { filter: { address: '0xabc' }, listenerFactory: vi.fn() } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });

    expect(out).toEqual({ status: 'no_gap' });
  });

  it('#2 - on completed gap fill updates live head and clears backfill state', async () => {
    const repo = {
      findByIdWithChain: vi.fn().mockResolvedValue({
        id: 'src-1',
        active_from_block: '100',
        backfill_head_block: null,
        live_head_block: '180',
      }),
      updateLiveHead: vi.fn().mockResolvedValue(undefined),
      clearBackfillState: vi.fn().mockResolvedValue(undefined),
    } as never;

    const rpc = { send: vi.fn().mockResolvedValue('0xd2') } as never; // 210
    const { BackfillDriver } = await import('./backfill-driver');
    vi.mocked(BackfillDriver).mockImplementation(function () {
      return {
        run: vi.fn().mockResolvedValue({
          status: 'completed',
          fromBlock: 181n,
          toBlock: 200n,
        }),
      };
    } as never);

    const out = await runStartupGapFill({
      daoSourceId: 'src-1',
      chainConfig: { reorgHorizon: 5 } as never,
      rpcClient: rpc,
      daoSourceRepo: repo,
      runtime: { filter: { address: '0xabc' }, listenerFactory: vi.fn() } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });

    expect(repo.updateLiveHead).toHaveBeenCalledWith('src-1', 200n);
    expect(repo.clearBackfillState).toHaveBeenCalledWith('src-1');
    expect(out).toEqual({ status: 'filled', fromBlock: 181n, toBlock: 200n });
  });
});
