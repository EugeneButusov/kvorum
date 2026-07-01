import { describe, expect, it } from 'vitest';
import { DelegateRegistryActorAddressDeriver } from './actor-address-deriver';

const DELEGATOR = `0x${'11'.repeat(20)}`;
const DELEGATE = `0x${'22'.repeat(20)}`;
const ZERO = `0x${'00'.repeat(20)}`;

const deriver = new DelegateRegistryActorAddressDeriver({} as never);

describe('DelegateRegistryActorAddressDeriver.extractAddresses', () => {
  it('extracts delegator + delegate from SetDelegate', () => {
    const got = deriver.extractAddresses(
      'SetDelegate',
      JSON.stringify({ delegator: DELEGATOR, id: '0x00', delegate: DELEGATE }),
    );
    expect(got).toEqual([
      { address: DELEGATOR, source: 'delegator_event' },
      { address: DELEGATE, source: 'delegate_event' },
    ]);
  });

  it('skips the zero delegate', () => {
    const got = deriver.extractAddresses(
      'ClearDelegate',
      JSON.stringify({ delegator: DELEGATOR, id: '0x00', delegate: ZERO }),
    );
    expect(got).toEqual([{ address: DELEGATOR, source: 'delegator_event' }]);
  });

  it('ignores unrelated event types', () => {
    expect(deriver.extractAddresses('VoteCast', '{}')).toEqual([]);
  });

  it('throws on a malformed delegator field', () => {
    expect(() =>
      deriver.extractAddresses(
        'SetDelegate',
        JSON.stringify({ delegator: 'nope', delegate: DELEGATE }),
      ),
    ).toThrow();
  });
});
