import { describe, expect, it, vi } from 'vitest';
import { BackfillDriver } from './backfill-driver';
import { runStartupGapFill } from './startup-gap-fill';

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
      }),
    };

    const rpc = { send: vi.fn().mockResolvedValue('0xd2') };

    return {
      repo,
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

  it('#1 - returns no_gap when computed range is empty', async () => {
    const { input } = makeBase();
    const out = await runStartupGapFill(input);
    expect(out).toEqual({ status: 'no_gap' });
  });

  it('#2 - returns skipped when active_from/backfill are null', async () => {
    const { input, repo } = makeBase();
    repo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: null,
      backfill_head_block: null,
    });

    const out = await runStartupGapFill(input);
    expect(out).toEqual({ status: 'skipped', reason: 'no_active_from_block' });
  });

  it('#3 - returns filled after completed outcome', async () => {
    const { input, repo } = makeBase();
    repo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: '100',
      backfill_head_block: '100',
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
  });
});
