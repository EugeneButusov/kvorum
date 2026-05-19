import { describe, expect, it, vi } from 'vitest';
import { runStartupGapFill } from './startup-gap-fill';
import { BackfillDriver } from './backfill-driver';

vi.mock('./backfill-driver', () => ({
  BackfillDriver: vi.fn(),
}));

describe('runStartupGapFill', () => {
  function makeBase() {
    const repo = {
      findByIdWithChain: vi.fn().mockResolvedValue({
        id: 'src-1',
        source_type: 'compound_governor_bravo',
        active_from_block: '100',
        backfill_head_block: '200',
        live_head_block: '205',
      }),
      clearBackfillState: vi.fn().mockResolvedValue(undefined),
    };

    const rpc = { send: vi.fn().mockResolvedValue('0xd2') };

    return {
      repo,
      rpc,
      input: {
        daoSourceId: 'src-1',
        chainConfig: { reorgHorizon: 5 } as never,
        rpcClient: rpc as never,
        daoSourceRepo: repo as never,
        runtime: { filter: { address: '0xabc' }, listenerFactory: vi.fn() } as never,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      },
    };
  }

  it('#1 - returns no_gap when compute gap is empty', async () => {
    const { input } = makeBase();

    const out = await runStartupGapFill(input);

    expect(out).toEqual({ status: 'no_gap' });
  });

  it('#2 - returns skipped when active_from/backfill/live are all null', async () => {
    const { input, repo } = makeBase();
    repo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: null,
      backfill_head_block: null,
      live_head_block: null,
    });

    const out = await runStartupGapFill(input);
    expect(out).toEqual({ status: 'skipped', reason: 'no_active_from_block' });
  });

  it('#3 - returns filled and clears state after completed outcome', async () => {
    const { input, repo } = makeBase();
    repo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: '100',
      backfill_head_block: '100',
      live_head_block: null,
    });
    vi.mocked(BackfillDriver).mockImplementation(function () {
      return {
        run: vi.fn().mockResolvedValue({
          status: 'completed',
          fromBlock: 101n,
          toBlock: 200n,
        }),
      } as never;
    });

    const out = await runStartupGapFill(input);
    expect(out).toEqual({ status: 'filled', fromBlock: 101n, toBlock: 200n });
    expect(repo.clearBackfillState).toHaveBeenCalledWith('src-1');
  });

  it('#4 - returns cancelled when backfill driver is cancelled', async () => {
    const { input, repo } = makeBase();
    repo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: '100',
      backfill_head_block: '100',
      live_head_block: null,
    });
    vi.mocked(BackfillDriver).mockImplementation(function () {
      return {
        run: vi.fn().mockResolvedValue({ status: 'cancelled', resumeFromBlock: 150n }),
      } as never;
    });

    const out = await runStartupGapFill(input);
    expect(out).toEqual({ status: 'cancelled' });
  });

  it('#5 - returns error when backfill driver errors', async () => {
    const { input, repo } = makeBase();
    repo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: '100',
      backfill_head_block: '100',
      live_head_block: null,
    });
    vi.mocked(BackfillDriver).mockImplementation(function () {
      return {
        run: vi.fn().mockResolvedValue({ status: 'error', error: new Error('boom') }),
      } as never;
    });

    const out = await runStartupGapFill(input);
    expect(out).toEqual({ status: 'error', error: expect.any(Error) });
  });
});
