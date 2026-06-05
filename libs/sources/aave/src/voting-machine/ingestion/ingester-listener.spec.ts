import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { makeAaveVotingMachineIngesterListener } from './ingester-listener';
import type { AaveVotingMachineIngesterListenerDeps } from './ingester-listener';

const { makeIngesterListenerMock, decodeAaveVotingMachineLogMock } = vi.hoisted(() => ({
  makeIngesterListenerMock: vi.fn(),
  decodeAaveVotingMachineLogMock: vi.fn(),
}));

vi.mock('@sources/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sources/core')>();
  return {
    ...actual,
    makeIngesterListener: makeIngesterListenerMock,
  };
});

vi.mock('../abi/decoder', () => ({
  decodeAaveVotingMachineLog: decodeAaveVotingMachineLogMock,
}));

describe('makeAaveVotingMachineIngesterListener', () => {
  it('delegates to makeIngesterListener with a decode function bound to context.sourceType', () => {
    const listener = vi.fn();
    makeIngesterListenerMock.mockReturnValue(listener);
    const deps = {
      archiveWriter: {} as AaveVotingMachineIngesterListenerDeps['archiveWriter'],
      context: {
        daoSourceId: 'dao-source-1',
        sourceType: 'aave_voting_machine',
        chainId: '0x89',
        sourceLabel: 'aave_voting_machine',
      },
      logger: {} as AaveVotingMachineIngesterListenerDeps['logger'],
      dlqRepo: {} as AaveVotingMachineIngesterListenerDeps['dlqRepo'],
    } satisfies AaveVotingMachineIngesterListenerDeps;
    const options = { onWriteFailure: 'throw' as const };
    const log = { txHash: '0x1' } as LogEvent;
    const decoded = { type: 'ProposalResultsSent', payload: {} };
    decodeAaveVotingMachineLogMock.mockReturnValue(decoded);

    const result = makeAaveVotingMachineIngesterListener(deps, options);
    const decode = makeIngesterListenerMock.mock.calls[0][1] as (log: LogEvent) => unknown;

    expect(result).toBe(listener);
    expect(makeIngesterListenerMock).toHaveBeenCalledWith(deps, expect.any(Function), options);
    expect(decode(log)).toBe(decoded);
    expect(decodeAaveVotingMachineLogMock).toHaveBeenCalledWith(log, deps.context.sourceType);
  });
});
