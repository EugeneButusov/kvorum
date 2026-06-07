import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { makeAavePayloadsControllerIngesterListener } from './ingester-listener';
import type { AavePayloadsControllerIngesterListenerDeps } from './ingester-listener';

const { makeIngesterListenerMock, decodeAavePayloadsControllerLogMock } = vi.hoisted(() => ({
  makeIngesterListenerMock: vi.fn(),
  decodeAavePayloadsControllerLogMock: vi.fn(),
}));

vi.mock('@sources/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sources/core')>();
  return {
    ...actual,
    makeIngesterListener: makeIngesterListenerMock,
  };
});

vi.mock('../abi/decoder', () => ({
  decodeAavePayloadsControllerLog: decodeAavePayloadsControllerLogMock,
}));

describe('makeAavePayloadsControllerIngesterListener', () => {
  it('delegates to makeIngesterListener with a decode function bound to context.sourceType', () => {
    const listener = vi.fn();
    makeIngesterListenerMock.mockReturnValue(listener);
    const deps = {
      archiveWriter: {} as AavePayloadsControllerIngesterListenerDeps['archiveWriter'],
      context: {
        daoSourceId: 'dao-source-1',
        sourceType: 'aave_payloads_controller',
        chainId: '0x1',
        sourceLabel: 'aave_payloads_controller',
      },
      logger: {} as AavePayloadsControllerIngesterListenerDeps['logger'],
      dlqRepo: {} as AavePayloadsControllerIngesterListenerDeps['dlqRepo'],
    } satisfies AavePayloadsControllerIngesterListenerDeps;
    const options = { onWriteFailure: 'throw' as const };
    const log = { txHash: '0x1' } as LogEvent;
    const decoded = { type: 'PayloadExecuted', payload: { payloadId: '1' } };
    decodeAavePayloadsControllerLogMock.mockReturnValue(decoded);

    const result = makeAavePayloadsControllerIngesterListener(deps, options);
    const decode = makeIngesterListenerMock.mock.calls[0][1] as (log: LogEvent) => unknown;

    expect(result).toBe(listener);
    expect(makeIngesterListenerMock).toHaveBeenCalledWith(deps, expect.any(Function), options);
    expect(decode(log)).toBe(decoded);
    expect(decodeAavePayloadsControllerLogMock).toHaveBeenCalledWith(log, deps.context.sourceType);
  });
});
