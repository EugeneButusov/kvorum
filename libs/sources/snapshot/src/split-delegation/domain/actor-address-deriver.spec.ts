import { describe, expect, it } from 'vitest';
import { SplitDelegationActorAddressDeriver } from './actor-address-deriver';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const D1 = `0x${'00'.repeat(12)}${'22'.repeat(20)}`;
const CROSS = `0x${'11'}${'00'.repeat(11)}${'22'.repeat(20)}`;

const deriver = new SplitDelegationActorAddressDeriver({} as never);

describe('SplitDelegationActorAddressDeriver.extractAddresses', () => {
  it('extracts account + EVM delegates from DelegationUpdated', () => {
    const got = deriver.extractAddresses(
      'DelegationUpdated',
      JSON.stringify({
        account: ACCOUNT,
        context: 'lido-snapshot.eth',
        delegation: [{ delegate: D1, ratio: '1' }],
      }),
    );
    expect(got).toEqual([
      { address: ACCOUNT, source: 'delegator_event' },
      { address: `0x${'22'.repeat(20)}`, source: 'delegate_event' },
    ]);
  });

  it('skips cross-chain (non-EVM) delegate ids', () => {
    const got = deriver.extractAddresses(
      'DelegationUpdated',
      JSON.stringify({ account: ACCOUNT, delegation: [{ delegate: CROSS, ratio: '1' }] }),
    );
    expect(got).toEqual([{ address: ACCOUNT, source: 'delegator_event' }]);
  });

  it('extracts only the account from DelegationCleared', () => {
    const got = deriver.extractAddresses(
      'DelegationCleared',
      JSON.stringify({ account: ACCOUNT, context: 'lido-snapshot.eth' }),
    );
    expect(got).toEqual([{ address: ACCOUNT, source: 'delegator_event' }]);
  });

  it('extracts the delegate from OptOutStatusSet', () => {
    const got = deriver.extractAddresses(
      'OptOutStatusSet',
      JSON.stringify({
        delegate: `0x${'22'.repeat(20)}`,
        context: 'lido-snapshot.eth',
        optout: true,
      }),
    );
    expect(got).toEqual([{ address: `0x${'22'.repeat(20)}`, source: 'delegate_event' }]);
  });
});
