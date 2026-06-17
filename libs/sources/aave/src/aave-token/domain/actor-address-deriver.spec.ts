import { describe, expect, it, vi } from 'vitest';
import type { ArchiveDerivationRow } from '@libs/db';
import { AaveTokenActorAddressDeriver } from './actor-address-deriver';
import { AaveTokenArchivePayloadRepository } from '../persistence/archive-payload-repository';

const DELEGATOR = `0x${'ab'.repeat(20)}`;
const DELEGATEE = `0x${'ef'.repeat(20)}`;
const ZERO = '0x0000000000000000000000000000000000000000';

function makeDeriver() {
  const payloads = {
    fetchPayloads: vi.fn().mockResolvedValue([]),
  } as unknown as AaveTokenArchivePayloadRepository;
  return { deriver: new AaveTokenActorAddressDeriver(payloads), payloads };
}

describe('AaveTokenActorAddressDeriver', () => {
  it('declares actor-address kind, aave_token source, DelegateChanged event', () => {
    const { deriver } = makeDeriver();
    expect(deriver.kind).toBe('actor-address');
    expect(deriver.sourceTypes).toEqual(['aave_token']);
    expect(deriver.eventTypes).toEqual(['DelegateChanged']);
  });

  it('extracts delegator + delegatee from a DelegateChanged payload', () => {
    const { deriver } = makeDeriver();
    const candidates = deriver.extractAddresses(
      'DelegateChanged',
      JSON.stringify({ delegator: DELEGATOR, delegatee: DELEGATEE, delegationType: 0 }),
    );
    expect(candidates).toEqual([
      { address: DELEGATOR, source: 'delegator_event' },
      { address: DELEGATEE, source: 'delegate_event' },
    ]);
  });

  it('omits an address(0) delegatee (undelegation) and keeps the delegator', () => {
    const { deriver } = makeDeriver();
    const candidates = deriver.extractAddresses(
      'DelegateChanged',
      JSON.stringify({ delegator: DELEGATOR, delegatee: ZERO, delegationType: 1 }),
    );
    expect(candidates).toEqual([{ address: DELEGATOR, source: 'delegator_event' }]);
  });

  it('returns no candidates for a non-DelegateChanged event', () => {
    const { deriver } = makeDeriver();
    expect(deriver.extractAddresses('VoteCast', '{}')).toEqual([]);
  });

  it('throws on an invalid delegator field', () => {
    const { deriver } = makeDeriver();
    expect(() =>
      deriver.extractAddresses('DelegateChanged', JSON.stringify({ delegator: 'nope' })),
    ).toThrow(/delegator_event/);
  });

  it('delegates fetchPayloads to the archive payload repository', async () => {
    const { deriver, payloads } = makeDeriver();
    const rows = [] as ArchiveDerivationRow[];
    await deriver.fetchPayloads(rows);
    expect(payloads.fetchPayloads).toHaveBeenCalledWith(rows);
  });
});
