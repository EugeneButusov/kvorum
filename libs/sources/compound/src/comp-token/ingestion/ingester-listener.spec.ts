import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { makeCompTokenIngesterListener } from './ingester-listener';
import type { CompTokenIngesterListenerDeps } from './ingester-listener';

const { makeIngesterListenerMock, decodeCompTokenLogMock } = vi.hoisted(() => ({
  makeIngesterListenerMock: vi.fn(),
  decodeCompTokenLogMock: vi.fn(),
}));

vi.mock('@sources/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sources/core')>();
  return {
    ...actual,
    makeIngesterListener: makeIngesterListenerMock,
  };
});

vi.mock('../abi/decoder', () => ({
  decodeCompTokenLog: decodeCompTokenLogMock,
}));

describe('makeCompTokenIngesterListener', () => {
  it('delegates to makeIngesterListener with the comp-token decoder', () => {
    const listener = vi.fn();
    makeIngesterListenerMock.mockReturnValue(listener);
    const deps = {
      archiveWriter: {} as CompTokenIngesterListenerDeps['archiveWriter'],
      context: {
        daoSourceId: 'dao-source-1',
        sourceType: 'compound_comp_token',
        chainId: '1',
        sourceLabel: 'compound_comp_token',
      },
      logger: {} as CompTokenIngesterListenerDeps['logger'],
      dlqRepo: {} as CompTokenIngesterListenerDeps['dlqRepo'],
    } satisfies CompTokenIngesterListenerDeps;
    const options = { onWriteFailure: 'throw' as const };
    const log = { txHash: '0x1' } as LogEvent;
    const decoded = { type: 'DelegateChanged', payload: {} };
    decodeCompTokenLogMock.mockReturnValue(decoded);

    const result = makeCompTokenIngesterListener(deps, options);
    const decode = makeIngesterListenerMock.mock.calls[0][1] as (log: LogEvent) => unknown;

    expect(result).toBe(listener);
    expect(makeIngesterListenerMock).toHaveBeenCalledWith(deps, expect.any(Function), options);
    expect(decode(log)).toBe(decoded);
    expect(decodeCompTokenLogMock).toHaveBeenCalledWith(log);
  });
});
