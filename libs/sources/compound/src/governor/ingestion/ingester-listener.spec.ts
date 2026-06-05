import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { makeGovernorIngesterListener } from './ingester-listener';
import type { IngesterListenerDeps } from './ingester-listener';

const { makeIngesterListenerMock, decodeCompoundLogMock } = vi.hoisted(() => ({
  makeIngesterListenerMock: vi.fn(),
  decodeCompoundLogMock: vi.fn(),
}));

vi.mock('@sources/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sources/core')>();
  return {
    ...actual,
    makeIngesterListener: makeIngesterListenerMock,
  };
});

vi.mock('../abi/decoder', () => ({
  decodeCompoundLog: decodeCompoundLogMock,
}));

describe('makeGovernorIngesterListener', () => {
  it('delegates to makeIngesterListener with a decode function bound to context.sourceType', () => {
    const listener = vi.fn();
    makeIngesterListenerMock.mockReturnValue(listener);
    const deps = {
      archiveWriter: {} as IngesterListenerDeps['archiveWriter'],
      context: {
        daoSourceId: 'dao-source-1',
        sourceType: 'compound_governor_bravo',
        chainId: 1,
        sourceLabel: 'compound_governor_bravo',
      },
      logger: {} as IngesterListenerDeps['logger'],
      dlqRepo: {} as IngesterListenerDeps['dlqRepo'],
    } satisfies IngesterListenerDeps;
    const options = { onWriteFailure: 'throw' as const };
    const log = { txHash: '0x1' } as LogEvent;
    const decoded = { type: 'ProposalExecuted', payload: {} };
    decodeCompoundLogMock.mockReturnValue(decoded);

    const result = makeGovernorIngesterListener(deps, options);
    const decode = makeIngesterListenerMock.mock.calls[0][1] as (log: LogEvent) => unknown;

    expect(result).toBe(listener);
    expect(makeIngesterListenerMock).toHaveBeenCalledWith(deps, expect.any(Function), options);
    expect(decode(log)).toBe(decoded);
    expect(decodeCompoundLogMock).toHaveBeenCalledWith(log, deps.context.sourceType);
  });
});
