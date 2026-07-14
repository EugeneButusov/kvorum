import { resolveStep } from './use-siwe-flow';

describe('resolveStep', () => {
  const base = { isConnected: false, isConnecting: false, isCorrectChain: false };

  it('maps the connect phase through the wallet states', () => {
    expect(resolveStep({ ...base, phase: 'connect' })).toBe('disconnected');
    expect(resolveStep({ ...base, phase: 'connect', isConnecting: true })).toBe('connecting');
    expect(resolveStep({ ...base, phase: 'connect', isConnected: true })).toBe('wrong-chain');
    expect(
      resolveStep({ ...base, phase: 'connect', isConnected: true, isCorrectChain: true }),
    ).toBe('signing');
  });

  it('honours terminal phases regardless of wallet state', () => {
    expect(
      resolveStep({ ...base, phase: 'signing', isConnected: true, isCorrectChain: true }),
    ).toBe('signing');
    expect(resolveStep({ ...base, phase: 'error' })).toBe('error');
    expect(resolveStep({ ...base, phase: 'success' })).toBe('success');
  });
});
