import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { makeAaveGovernanceIngesterListener } from './ingester-listener';
import type { AaveGovernanceIngesterListenerDeps } from './ingester-listener';

const { makeIngesterListenerMock, decodeAaveGovernanceV3LogMock } = vi.hoisted(() => ({
  makeIngesterListenerMock: vi.fn(),
  decodeAaveGovernanceV3LogMock: vi.fn(),
}));

vi.mock('@sources/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sources/core')>();
  return {
    ...actual,
    makeIngesterListener: makeIngesterListenerMock,
  };
});

vi.mock('../abi/decoder', () => ({
  decodeAaveGovernanceV3Log: decodeAaveGovernanceV3LogMock,
}));

describe('makeAaveGovernanceIngesterListener', () => {
  it('delegates to makeIngesterListener with a decode function bound to context.sourceType', () => {
    const listener = vi.fn();
    makeIngesterListenerMock.mockReturnValue(listener);
    const deps = {
      archiveWriter: {} as AaveGovernanceIngesterListenerDeps['archiveWriter'],
      context: {
        daoSourceId: 'dao-source-1',
        sourceType: 'aave_governance_v3',
        chainId: '0x1',
        sourceLabel: 'aave_governance_v3',
      },
      logger: {} as AaveGovernanceIngesterListenerDeps['logger'],
      dlqRepo: {} as AaveGovernanceIngesterListenerDeps['dlqRepo'],
    } satisfies AaveGovernanceIngesterListenerDeps;
    const options = { onWriteFailure: 'throw' as const };
    const log = { txHash: '0x1' } as LogEvent;
    const decoded = { type: 'ProposalExecuted', payload: {} };
    decodeAaveGovernanceV3LogMock.mockReturnValue(decoded);

    const result = makeAaveGovernanceIngesterListener(deps, options);
    const decode = makeIngesterListenerMock.mock.calls[0][1] as (log: LogEvent) => unknown;

    expect(result).toBe(listener);
    expect(makeIngesterListenerMock).toHaveBeenCalledWith(deps, expect.any(Function), options);
    expect(decode(log)).toBe(decoded);
    expect(decodeAaveGovernanceV3LogMock).toHaveBeenCalledWith(log, deps.context.sourceType);
  });
});
