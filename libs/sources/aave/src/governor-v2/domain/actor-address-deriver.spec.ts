import { describe, expect, it, vi } from 'vitest';
import { AaveGovernorV2ActorAddressDeriver } from './actor-address-deriver';
import type { AaveGovernorV2ArchivePayloadRepository } from '../persistence/archive-payload-repository';

function makePayloads(): AaveGovernorV2ArchivePayloadRepository {
  return {
    fetchPayloads: vi.fn().mockResolvedValue([]),
  } as unknown as AaveGovernorV2ArchivePayloadRepository;
}

describe('AaveGovernorV2ActorAddressDeriver', () => {
  it('has kind actor-address and sourceTypes [aave_governor_v2]', () => {
    const deriver = new AaveGovernorV2ActorAddressDeriver(makePayloads());
    expect(deriver.kind).toBe('actor-address');
    expect(deriver.sourceTypes).toEqual(['aave_governor_v2']);
  });

  it('extracts creator from ProposalCreated', () => {
    const deriver = new AaveGovernorV2ActorAddressDeriver(makePayloads());
    const result = deriver.extractAddresses(
      'ProposalCreated',
      JSON.stringify({
        id: '5',
        creator: '0x1111111111111111111111111111111111111111',
        executor: '0x2222222222222222222222222222222222222222',
      }),
    );

    expect(result).toEqual([
      { address: '0x1111111111111111111111111111111111111111', source: 'proposer_event' },
    ]);
  });

  it('lowercases the creator address', () => {
    const deriver = new AaveGovernorV2ActorAddressDeriver(makePayloads());
    const result = deriver.extractAddresses(
      'ProposalCreated',
      JSON.stringify({ creator: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12' }),
    );

    expect(result[0]?.address).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });

  it('extracts voter from VoteEmitted', () => {
    const deriver = new AaveGovernorV2ActorAddressDeriver(makePayloads());
    const result = deriver.extractAddresses(
      'VoteEmitted',
      JSON.stringify({
        id: '5',
        voter: '0xaaaa111111111111111111111111111111111111',
        support: true,
        votingPower: '100',
      }),
    );

    expect(result).toEqual([
      { address: '0xaaaa111111111111111111111111111111111111', source: 'voter_event' },
    ]);
  });

  it('returns empty array for non-address events (ProposalQueued, ProposalExecuted, ProposalCanceled)', () => {
    const deriver = new AaveGovernorV2ActorAddressDeriver(makePayloads());

    for (const eventType of ['ProposalQueued', 'ProposalExecuted', 'ProposalCanceled']) {
      const result = deriver.extractAddresses(eventType, JSON.stringify({ id: '1' }));
      expect(result).toHaveLength(0);
    }
  });

  it('throws on invalid creator address format', () => {
    const deriver = new AaveGovernorV2ActorAddressDeriver(makePayloads());
    expect(() =>
      deriver.extractAddresses('ProposalCreated', JSON.stringify({ creator: 'not-an-address' })),
    ).toThrow('invalid ProposalCreated.creator payload field');
  });

  it('throws on invalid voter address format', () => {
    const deriver = new AaveGovernorV2ActorAddressDeriver(makePayloads());
    expect(() =>
      deriver.extractAddresses('VoteEmitted', JSON.stringify({ voter: '0x123' })),
    ).toThrow('invalid VoteEmitted.voter payload field');
  });
});
