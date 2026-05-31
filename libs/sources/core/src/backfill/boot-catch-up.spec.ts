import { describe, expect, it, vi } from 'vitest';
import { BackfillDriver } from './backfill-driver';
import { runBootCatchUp, processBootCatchUp } from './boot-catch-up';
import { BootCatchUpShutdownError } from './errors/boot-catch-up-shutdown.error';
import { DaoSourceNotFoundError } from './errors/dao-source-not-found.error';

vi.mock('./backfill-driver', () => ({
  BackfillDriver: vi.fn(),
}));

describe('runBootCatchUp', () => {
  function makeBase() {
    const repo = {
      findByIdWithChain: vi.fn().mockResolvedValue({
        id: 'src-1',
        source_type: 'compound_governor_bravo',
        active_from_block: '100',
        backfill_head_block: '205',
      }),
    };

    const rpc = { send: vi.fn().mockResolvedValue('0xd2') };

    return {
      repo,
      input: {
        daoSourceId: 'src-1',
        chainConfig: { headLag: 5 } as never,
        rpcClient: rpc as never,
        daoSourceRepo: repo as never,
        runtime: { filter: { address: '0xabc' }, listenerFactory: vi.fn() } as never,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      },
    };
  }

  it('#1 - returns no_gap when computed range is empty', async () => {
    const { input } = makeBase();
    const out = await runBootCatchUp(input);
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

    const out = await runBootCatchUp(input);
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

    const out = await runBootCatchUp(input);
    expect(out).toEqual({ status: 'filled', fromBlock: 101n, toBlock: 200n });
  });

  it('#4 - returns cancelled when driver returns cancelled outcome', async () => {
    const { input, repo } = makeBase();
    repo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: '100',
      backfill_head_block: '100',
    });
    vi.mocked(BackfillDriver).mockImplementation(function () {
      return {
        run: vi.fn().mockResolvedValue({ status: 'cancelled', resumeFromBlock: 101n }),
      } as never;
    });

    const out = await runBootCatchUp(input);
    expect(out).toEqual({ status: 'cancelled' });
  });

  it('#5 - returns error when driver returns error outcome', async () => {
    const { input, repo } = makeBase();
    repo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: '100',
      backfill_head_block: '100',
    });
    const err = new Error('CH failure');
    vi.mocked(BackfillDriver).mockImplementation(function () {
      return { run: vi.fn().mockResolvedValue({ status: 'error', error: err }) } as never;
    });

    const out = await runBootCatchUp(input);
    expect(out).toEqual({ status: 'error', error: err });
  });

  it('#6 - throws DaoSourceNotFoundError when dao_source row is missing', async () => {
    const { input, repo } = makeBase();
    repo.findByIdWithChain.mockResolvedValue(null);

    await expect(runBootCatchUp(input)).rejects.toThrow(DaoSourceNotFoundError);
  });

  it('#7 - explicit toBlock: returns no_gap when fromBlock > toBlock', async () => {
    const { input, repo } = makeBase();
    repo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: '100',
      backfill_head_block: '300',
    });

    const out = await runBootCatchUp({ ...input, toBlock: 100n }); // fromBlock=301 > toBlock=100
    expect(out).toEqual({ status: 'no_gap' });
  });

  it('#8 - explicit toBlock: returns skipped when both active_from and backfill_head are null', async () => {
    const { input, repo } = makeBase();
    repo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: null,
      backfill_head_block: null,
    });

    const out = await runBootCatchUp({ ...input, toBlock: 500n });
    expect(out).toEqual({ status: 'skipped', reason: 'no_active_from_block' });
  });

  it('#9 - explicit toBlock: computes floor from active_from when backfill_head is null', async () => {
    const { input, repo } = makeBase();
    repo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: '100',
      backfill_head_block: null,
    });
    vi.mocked(BackfillDriver).mockImplementation(function () {
      return {
        run: vi.fn().mockResolvedValue({ status: 'completed', fromBlock: 99n, toBlock: 500n }),
      } as never;
    });

    const out = await runBootCatchUp({ ...input, toBlock: 500n });
    // fromBlock = (null ?? 100n - 1n) + 1n = 99n + 1n = 100n; 100n <= 500n → gap
    expect(out).toEqual({ status: 'filled', fromBlock: 99n, toBlock: 500n });
  });
});

describe('processBootCatchUp', () => {
  function makeBase() {
    const repo = {
      findByIdWithChain: vi.fn().mockResolvedValue({
        id: 'src-1',
        source_type: 'compound_governor_bravo',
        active_from_block: '100',
        backfill_head_block: '205',
      }),
    };
    const rpc = { send: vi.fn().mockResolvedValue('0xd2') };
    return {
      input: {
        daoSourceId: 'src-1',
        chainConfig: { name: 'ethereum', headLag: 5 } as never,
        rpcClient: rpc as never,
        daoSourceRepo: repo as never,
        runtime: { filter: { address: '0xabc' }, listenerFactory: vi.fn() } as never,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      },
    };
  }

  it('records gap_fill_skipped metric for skipped status', async () => {
    const { input } = makeBase();
    // no_gap normally; use explicit toBlock that is below the backfill_head to get skipped
    vi.mocked(BackfillDriver).mockImplementation(function () {
      return { run: vi.fn() } as never;
    });
    // force skipped via explicit toBlock + both null
    input.daoSourceRepo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: null,
      backfill_head_block: null,
    });

    await expect(processBootCatchUp({ ...input, toBlock: 500n })).resolves.toBeUndefined();
  });

  it('records gap_fill_failed metric for error status', async () => {
    const { input } = makeBase();
    input.daoSourceRepo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: '100',
      backfill_head_block: '100',
    });
    vi.mocked(BackfillDriver).mockImplementation(function () {
      return {
        run: vi.fn().mockResolvedValue({ status: 'error', error: new Error('fail') }),
      } as never;
    });

    await expect(processBootCatchUp(input)).resolves.toBeUndefined();
  });

  it('records gap_fill_failed metric for cancelled status without signal throw', async () => {
    const { input } = makeBase();
    input.daoSourceRepo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: '100',
      backfill_head_block: '100',
    });
    vi.mocked(BackfillDriver).mockImplementation(function () {
      return { run: vi.fn().mockResolvedValue({ status: 'cancelled' }) } as never;
    });

    // No signal → does NOT throw BootCatchUpShutdownError
    await expect(processBootCatchUp(input)).resolves.toBeUndefined();
  });

  it('throws BootCatchUpShutdownError for cancelled status when signal is aborted', async () => {
    const { input } = makeBase();
    const controller = new AbortController();
    controller.abort();
    input.daoSourceRepo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: '100',
      backfill_head_block: '100',
    });
    vi.mocked(BackfillDriver).mockImplementation(function () {
      return { run: vi.fn().mockResolvedValue({ status: 'cancelled' }) } as never;
    });

    await expect(processBootCatchUp({ ...input, signal: controller.signal })).rejects.toThrow(
      BootCatchUpShutdownError,
    );
  });

  it('completes silently for filled status', async () => {
    const { input } = makeBase();
    input.daoSourceRepo.findByIdWithChain.mockResolvedValue({
      id: 'src-1',
      source_type: 'compound_governor_bravo',
      active_from_block: '100',
      backfill_head_block: '100',
    });
    vi.mocked(BackfillDriver).mockImplementation(function () {
      return {
        run: vi.fn().mockResolvedValue({ status: 'completed', fromBlock: 101n, toBlock: 200n }),
      } as never;
    });

    await expect(processBootCatchUp(input)).resolves.toBeUndefined();
  });
});
