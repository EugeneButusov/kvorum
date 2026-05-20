import { describe, expect, it, vi } from 'vitest';
import { withDaoSourceAdvisoryLock } from './dao-source-lock';
import { runStartupGapFill, runStartupGapFillWithLock } from './startup-gap-fill';

vi.mock('./backfill-driver', () => ({
  BackfillDriver: vi.fn(),
}));
vi.mock('./dao-source-lock', () => ({
  withDaoSourceAdvisoryLock: vi.fn(),
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
});

describe('runStartupGapFillWithLock', () => {
  it('#1 - returns contended when advisory lock is contended', async () => {
    vi.mocked(withDaoSourceAdvisoryLock).mockResolvedValueOnce({
      status: 'contended',
    } as never);

    const out = await runStartupGapFillWithLock({
      daoSourceId: 'src-1',
      chainConfig: { reorgHorizon: 5 } as never,
      rpcClient: { send: vi.fn() } as never,
      daoSourceRepo: {} as never,
      runtime: { filter: { address: '0xabc' }, listenerFactory: vi.fn() } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });

    expect(out).toEqual({ status: 'contended' });
  });

  it('#2 - returns executed with startup result when lock acquired', async () => {
    vi.mocked(withDaoSourceAdvisoryLock).mockResolvedValueOnce({
      status: 'executed',
      value: { status: 'no_gap' },
    } as never);

    const out = await runStartupGapFillWithLock({
      daoSourceId: 'src-1',
      chainConfig: { reorgHorizon: 5 } as never,
      rpcClient: { send: vi.fn() } as never,
      daoSourceRepo: {} as never,
      runtime: { filter: { address: '0xabc' }, listenerFactory: vi.fn() } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });

    expect(out).toEqual({
      status: 'executed',
      value: { status: 'no_gap' },
    });
  });
});
