import { connectErrorMessage, resolveStep } from './use-siwe-flow';

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

describe('connectErrorMessage', () => {
  // These reach the reader now that the dialog connects on open: there is no longer a button
  // sitting there implying "try again", so the failure has to say what happened.
  it('names a missing extension as the thing to fix', () => {
    expect(
      connectErrorMessage(Object.assign(new Error('...'), { name: 'ConnectorNotFoundError' })),
    ).toMatch(/No browser wallet found/);
    expect(connectErrorMessage(new Error('ProviderNotFoundError: no provider'))).toMatch(
      /No browser wallet found/,
    );
  });

  it('treats a dismissed prompt as a cancellation, not a failure', () => {
    expect(
      connectErrorMessage(Object.assign(new Error('...'), { name: 'UserRejectedRequestError' })),
    ).toBe('Connection cancelled.');
    expect(connectErrorMessage(new Error('User rejected the request'))).toBe(
      'Connection cancelled.',
    );
  });

  it('falls back without leaking RPC detail', () => {
    const noisy = new Error('Request failed\n\nDetails: {"code":-32603}\nVersion: viem@2.0.0');
    expect(connectErrorMessage(noisy)).toBe('Could not connect to your wallet.');
    expect(connectErrorMessage(undefined)).toBe('Could not connect to your wallet.');
  });
});
